"""
build_matchups.py
-----------------
Builds the hitter-vs-pitcher data for matchups.html: every batter-pitcher pairing, every season,
1960-2026, with no minimum number of plate appearances.

Sources
    1960-2025  Retrosheet play-by-play event files (data/retrosheet/YYYYeve.zip, ~125 MB, not committed)
    2026       MLB Stats API play-by-play, saved by scripts/fetch_mlb_2026_pa.py (data/raw/mlb2026/pa_events.csv)

The information used here was obtained free of charge from and is copyrighted by Retrosheet.
Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.

Run from the repository root, after downloading the yearly zips
(https://www.retrosheet.org/events/YYYYeve.zip) into data/retrosheet/ and running fetch_mlb_2026_pa.py:
    python3 scripts/build_matchups.py

Outputs (data/matchups/)
    index.json       every player: [retroID, name, first year, last year, plate appearances as a batter,
                     batters faced as a pitcher], plus the 30 most-faced pairs
    b/<retroID>.csv  one file per hitter: every pitcher he faced, season by season
    p/<retroID>.csv  one file per pitcher: every hitter he faced, season by season
    ../matchups_meta.json   counts and the accuracy checks against data/batting.csv and data/pitching.csv
  Each row of a player file is: opponent index, year, PA, AB, H, 2B, 3B, HR, BB, HBP, SO, SF
  (the opponent index is the position of that player in index.json).

How a plate appearance is read: a Retrosheet `play` record names the batter and an event, and the
pitcher is whoever the fielding team last put on the mound (`start` / `sub` records with fielding
position 1). Each event is classified into a plate-appearance outcome or ignored (stolen bases, wild
pitches, pickoffs and other events where the batter's turn does not end). MLB's feed already names the
batter, pitcher and event type for every plate appearance.
"""

from array import array
from collections import Counter
from pathlib import Path
import io
import json
import re
import shutil
import sys
import zipfile

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prep_data  # noqa: E402  (reuses the 2026 player-id matching)

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "retrosheet"
START, END, MLB_YEAR = 1960, 2025, 2026
OUT = ROOT / "data" / "matchups"
COLS = ["PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF"]   # order of the counters
IDX = {c: i for i, c in enumerate(COLS)}
NON_PA = ("SB", "CS", "PO", "BK", "OA", "DI", "WP", "PB", "NP", "FLE")


def inc_tuple(**kw):
    inc = dict.fromkeys(COLS, 0)
    inc.update(kw)
    return tuple(inc[c] for c in COLS)


def classify(event):
    """Retrosheet event -> counter increments for one plate appearance, or None if the turn did not end."""
    main = event.split(".")[0]
    parts = main.split("/")
    comp = parts[0].split("+")[0]
    mods = parts[1:]
    if not comp or comp.startswith(NON_PA):
        return None
    if comp.startswith("HP"):
        return inc_tuple(PA=1, HBP=1)
    if comp.startswith("HR") or re.fullmatch(r"H\d?", comp):
        return inc_tuple(PA=1, AB=1, H=1, HR=1)
    if comp[0] == "S":
        return inc_tuple(PA=1, AB=1, H=1)
    if comp[0] == "D":
        return inc_tuple(PA=1, AB=1, H=1, **{"2B": 1})
    if comp[0] == "T":
        return inc_tuple(PA=1, AB=1, H=1, **{"3B": 1})
    if comp[0] == "K":
        return inc_tuple(PA=1, AB=1, SO=1)
    if comp[0] in "WI":                              # W, IW, I (intentional walk)
        return inc_tuple(PA=1, BB=1)
    if re.fullmatch(r"C\d?", comp):                  # catcher's interference: a PA, no AB
        return inc_tuple(PA=1)
    if "SF" in mods:                                 # sacrifice fly
        return inc_tuple(PA=1, SF=1)
    if "SH" in mods:                                 # sacrifice hit
        return inc_tuple(PA=1)
    return inc_tuple(PA=1, AB=1)                     # field out, fielder's choice, error


MLB_EVENTS = {
    "single": inc_tuple(PA=1, AB=1, H=1), "double": inc_tuple(PA=1, AB=1, H=1, **{"2B": 1}),
    "triple": inc_tuple(PA=1, AB=1, H=1, **{"3B": 1}), "home_run": inc_tuple(PA=1, AB=1, H=1, HR=1),
    "strikeout": inc_tuple(PA=1, AB=1, SO=1), "strikeout_double_play": inc_tuple(PA=1, AB=1, SO=1),
    "walk": inc_tuple(PA=1, BB=1), "intent_walk": inc_tuple(PA=1, BB=1), "hit_by_pitch": inc_tuple(PA=1, HBP=1),
    "sac_fly": inc_tuple(PA=1, SF=1), "sac_fly_double_play": inc_tuple(PA=1, SF=1),
    "sac_bunt": inc_tuple(PA=1), "sac_bunt_double_play": inc_tuple(PA=1), "catcher_interf": inc_tuple(PA=1),
    **{e: inc_tuple(PA=1, AB=1) for e in (
        "field_out", "force_out", "grounded_into_double_play", "double_play", "fielders_choice",
        "fielders_choice_out", "field_error", "triple_play", "batter_interference")},
}


class Collector:
    """Accumulates one row per plate appearance in compact arrays (about 11 million rows in all)."""

    def __init__(self):
        self.ids, self.id_list, self.names = {}, [], {}
        self.b, self.p, self.y = array("i"), array("i"), array("h")
        self.c = array("b")                      # counters, flattened: len(COLS) per plate appearance

    def pid(self, retro):
        i = self.ids.get(retro)
        if i is None:
            i = self.ids[retro] = len(self.id_list)
            self.id_list.append(retro)
        return i

    def add(self, batter, pitcher, year, inc):
        self.b.append(self.pid(batter))
        self.p.append(self.pid(pitcher))
        self.y.append(year)
        self.c.extend(inc)


def parse_zip(path, col):
    year = int(path.name[:4])
    with zipfile.ZipFile(path) as z:
        for member in sorted(z.namelist()):
            if not member.upper().endswith((".EVN", ".EVA")):
                continue
            pitcher = [None, None]
            for raw in io.TextIOWrapper(z.open(member), encoding="latin-1"):
                f = raw.rstrip("\r\n").split(",")
                kind = f[0]
                if kind == "id":
                    pitcher = [None, None]
                elif kind in ("start", "sub"):
                    pid, name, team, pos = f[1], f[2].strip('"'), int(f[3]), int(f[5])
                    col.names[pid] = name
                    if pos == 1:
                        pitcher[team] = pid
                elif kind == "play":
                    team, batter, event = int(f[2]), f[3], f[6]
                    p = pitcher[1 - team]
                    inc = classify(event)
                    if inc is not None and p is not None:
                        col.add(batter, p, year, inc)


def load_mlb_2026(col, people):
    """Append the 2026 plate appearances from the MLB feed, with players mapped to Retrosheet ids."""
    mlb_dir = ROOT / "data" / "raw" / "mlb2026"
    if not (mlb_dir / "pa_events.csv").exists():
        return None
    players = json.loads((mlb_dir / "players.json").read_text())
    lahman_id, _ = prep_data.mlb_id_map(people, players)          # MLB id -> Lahman id or 'mlb<id>'
    retro_of = people.dropna(subset=["retroID"]).set_index("playerID")["retroID"].to_dict()
    names_of = {}
    for mid, rec in players.items():
        lid = lahman_id[mid]
        retro = retro_of.get(lid, f"mlb{mid}")
        # keep a name that matches the one in the older data when the player already has a Retrosheet id
        col.names.setdefault(retro, rec["name"])
        names_of[mid] = retro
    ev = pd.read_csv(mlb_dir / "pa_events.csv")
    unknown, unmapped, used = Counter(), 0, 0
    for batter, pitcher, event in zip(ev["batter"], ev["pitcher"], ev["event"]):
        inc = MLB_EVENTS.get(event)
        if inc is None:
            unknown[event] += 1
            continue
        b, p = names_of.get(str(batter)), names_of.get(str(pitcher))
        if b is None or p is None:
            unmapped += 1
            b = b or f"mlb{batter}"
            p = p or f"mlb{pitcher}"
            col.names.setdefault(b, f"MLB player {batter}")
            col.names.setdefault(p, f"MLB player {pitcher}")
        col.add(b, p, MLB_YEAR, inc)
        used += 1
    return {"games": int(ev["game"].nunique()), "plays_in_feed": int(len(ev)), "plate_appearances": used,
            "ignored_event_types": dict(unknown), "players_not_in_player_list": unmapped}


def main():
    zips = sorted(z for z in SRC.glob("*eve.zip") if START <= int(z.name[:4]) <= END)
    if not zips:
        sys.exit(f"No *eve.zip files in {SRC}. Download them from https://www.retrosheet.org/events/")
    col = Collector()
    for z in zips:
        parse_zip(z, col)
        print("parsed", z.name[:4], end="\r", flush=True)
    print()
    people = prep_data.read_csv("People.csv")
    mlb_info = load_mlb_2026(col, people)
    years = sorted(set(col.y))
    n = len(col.b)
    print(f"{n:,} plate appearances, {len(col.id_list):,} players")

    # ---- one row per plate appearance -> one row per batter, pitcher and season
    # Players are numbered in alphabetical order of their Retrosheet id, so the index is stable.
    order = np.argsort(np.array(col.id_list, dtype=object).astype(str), kind="stable")
    rank = np.empty(len(order), dtype=np.int32)
    rank[order] = np.arange(len(order), dtype=np.int32)
    retro_ids = [col.id_list[i] for i in order]
    df = pd.DataFrame(np.frombuffer(col.c, dtype=np.int8).reshape(n, len(COLS)).astype(np.int32), columns=COLS)
    df["b"] = rank[np.frombuffer(col.b, dtype=np.int32)]
    df["p"] = rank[np.frombuffer(col.p, dtype=np.int32)]
    df["year"] = np.frombuffer(col.y, dtype=np.int16).astype(np.int32)
    agg = df.groupby(["b", "p", "year"], sort=True).sum().reset_index()
    del df
    print(f"{len(agg):,} batter-pitcher-season rows; {agg.groupby(['b', 'p']).ngroups:,} pairs")

    # ---- accuracy checks against the site's own hitting and pitching files (1960-2026)
    bat = pd.read_csv(ROOT / "data" / "batting.csv")
    lah = bat.groupby("year")[["PA", "AB", "H", "HR", "BB", "SO"]].sum()
    ev_year = agg.groupby("year")[["PA", "AB", "H", "HR", "BB", "SO"]].sum()
    rel = ((ev_year - lah).abs() / lah).dropna()
    worst_all = float(rel[["AB", "H", "HR", "BB", "SO"]].max().max())
    worst_1970 = float(rel.loc[rel.index >= 1970, ["AB", "H", "HR", "BB", "SO"]].max().max())
    coverage = {int(y): round(float(ev_year.loc[y, "AB"] / lah.loc[y, "AB"]), 4) for y in ev_year.index}
    print(f"season totals vs hitting file: worst {worst_all:.3%} overall, {worst_1970:.4%} from 1970 on")

    lahman_of = {r: r for r in retro_ids}                      # retro id -> id used in the site's files
    rp = people.dropna(subset=["retroID"]).set_index("retroID")["playerID"].to_dict()
    lahman_of = {r: rp.get(r, r) for r in retro_ids}           # 2026 'mlb<id>' ids are used as-is

    def check(side, file, stats, key):
        site = pd.read_csv(ROOT / "data" / file).groupby(["playerID", "year"])[stats].sum()
        sums = agg.groupby([key, "year"])[["PA", "H", "HR", "BB", "SO"]].sum().reset_index()
        sums["playerID"] = sums[key].map(lambda i: lahman_of[retro_ids[i]])
        sums = sums.groupby(["playerID", "year"])[["PA", "H", "HR", "BB", "SO"]].sum()
        joined = site.join(sums, rsuffix="_ev", how="inner")
        compare = [s for s in ["H", "HR", "BB", "SO"]]
        diffs = pd.concat([joined[s + "_ev"] - joined[s] for s in compare], axis=1)
        exact = (diffs == 0).all(axis=1)
        return {"seasons_compared": int(len(joined)), "seasons_exact": int(exact.sum()),
                "exact_share": round(float(exact.mean()), 4),
                "seasons_off_by_more_than_one": int((diffs.abs() > 1).any(axis=1).sum()),
                "net_difference": {s: int(diffs[i].sum()) for i, s in enumerate(compare)}}

    batter_check = check("batter", "batting.csv", ["H", "HR", "BB", "SO"], "b")
    pitcher_check = check("pitcher", "pitching.csv", ["H", "HR", "BB", "SO"], "p")
    print("batter check", batter_check)
    print("pitcher check", pitcher_check)

    # ---- player index
    first = agg.groupby("b")["year"].min().combine(agg.groupby("p")["year"].min(), min, fill_value=9999)
    last = agg.groupby("b")["year"].max().combine(agg.groupby("p")["year"].max(), max, fill_value=0)
    bpa = agg.groupby("b")["PA"].sum()
    ppa = agg.groupby("p")["PA"].sum()
    players = []
    for i, rid in enumerate(retro_ids):
        players.append([rid, col.names.get(rid, rid), int(first.get(i, 0)), int(last.get(i, 0)),
                        int(bpa.get(i, 0)), int(ppa.get(i, 0))])
    pairs = agg.groupby(["b", "p"])["PA"].sum().sort_values(ascending=False).head(30)
    top = [[int(b), int(p), int(v)] for (b, p), v in pairs.items()]

    # ---- per-player files
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "b").mkdir(parents=True)
    (OUT / "p").mkdir(parents=True)
    cols = COLS
    for role, key, opp in (("b", "b", "p"), ("p", "p", "b")):
        data = agg.sort_values([key, opp, "year"])
        arr = data[[opp, "year"] + cols].to_numpy(dtype=np.int32)
        owner = data[key].to_numpy()
        cuts = np.flatnonzero(np.diff(owner)) + 1
        starts = np.concatenate(([0], cuts))
        ends = np.concatenate((cuts, [len(owner)]))
        for s, e in zip(starts, ends):
            text = "\n".join(",".join(map(str, r)) for r in arr[s:e].tolist())
            (OUT / role / f"{retro_ids[owner[s]]}.csv").write_text(text + "\n")
    (OUT / "index.json").write_text(json.dumps({"years": [START, MLB_YEAR], "columns": ["opp", "year"] + cols,
                                                 "players": players, "top": top}, separators=(",", ":")))

    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    meta = {
        "years": [START, MLB_YEAR], "retrosheet_years": [START, END], "mlb_api_years": [MLB_YEAR],
        "players": len(players), "batters": int((bpa > 0).sum()), "pitchers": int((ppa > 0).sum()),
        "pairs": int(agg.groupby(["b", "p"]).ngroups), "rows": int(len(agg)),
        "plate_appearances": int(agg["PA"].sum()), "files": len(list((OUT / "b").glob("*.csv"))) + len(list((OUT / "p").glob("*.csv"))),
        "megabytes": round(size / 1e6, 1),
        "worst_relative_difference_vs_site": round(worst_all, 6),
        "worst_relative_difference_1970_on": round(worst_1970, 8),
        "season_coverage_ab": coverage,
        "batter_check": batter_check, "pitcher_check": pitcher_check, "mlb_2026": mlb_info,
    }
    (ROOT / "data" / "matchups_meta.json").write_text(json.dumps(meta, indent=1))
    print(f"wrote {meta['files']:,} player files + index.json ({meta['megabytes']} MB)")


if __name__ == "__main__":
    main()
