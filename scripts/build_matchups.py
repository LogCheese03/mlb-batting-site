"""
build_matchups.py
-----------------
Builds the batter-vs-pitcher data for matchups.html from Retrosheet play-by-play
event files (1960-2025).

The information used here was obtained free of charge from and is copyrighted by
Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.

Run from the repository root, after downloading the yearly event zips
(https://www.retrosheet.org/events/YYYYeve.zip) into data/retrosheet/:
    python3 scripts/build_matchups.py

Inputs:   data/retrosheet/1960eve.zip ... 2025eve.zip   (not committed; ~150 MB)
          data/batting.csv                                (used only to cross-check totals)
Outputs:  data/matchups.csv         one row per batter, pitcher and season (pairs with enough PA)
          data/matchup_players.csv  id -> name lookup for the ids used above
          data/matchups_meta.json   counts and the cross-check against the Lahman batting data

How a plate appearance is read: every `play` record names the batter and an event. The pitcher is
whoever the fielding team last put on the mound (`start` / `sub` records with fielding position 1).
Each event is classified into a plate-appearance outcome or ignored (stolen bases, wild pitches,
pickoffs and other events where the batter's turn does not end).
"""

from collections import defaultdict
from pathlib import Path
import io
import json
import re
import sys
import zipfile

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data" / "retrosheet"
RAW = ROOT / "data" / "raw"
START, END = 1960, 2025
MIN_CAREER_PA = 20          # keep only pairs who met at least this many times over 1960-2025
COLS = ["PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF"]   # order of the counters
IDX = {c: i for i, c in enumerate(COLS)}

NON_PA = ("SB", "CS", "PO", "BK", "OA", "DI", "WP", "PB", "NP", "FLE")


def classify(event):
    """Return a tuple of counter increments for one play, or None if the batter's turn did not end."""
    main = event.split(".")[0]
    parts = main.split("/")
    comp = parts[0].split("+")[0]
    mods = parts[1:]
    if not comp:
        return None
    if comp.startswith(NON_PA):
        return None
    inc = dict.fromkeys(COLS, 0)
    inc["PA"] = 1
    if comp.startswith("HP"):
        inc["HBP"] = 1
    elif comp.startswith("HR") or comp == "H" or re.fullmatch(r"H\d?", comp):
        inc["AB"] = inc["H"] = inc["HR"] = 1
    elif comp[0] == "S":
        inc["AB"] = inc["H"] = 1
    elif comp[0] == "D":
        inc["AB"] = inc["H"] = inc["2B"] = 1
    elif comp[0] == "T":
        inc["AB"] = inc["H"] = inc["3B"] = 1
    elif comp[0] == "K":
        inc["AB"] = inc["SO"] = 1
    elif comp[0] == "W" or comp[0] == "I":       # W, IW, I (intentional)
        inc["BB"] = 1
    elif comp == "C" or re.fullmatch(r"C\d?", comp):   # catcher's interference: PA, no AB
        pass
    else:                                          # field out, fielder's choice, error
        inc["AB"] = 1
        if "SF" in mods:
            inc["AB"] = 0
            inc["SF"] = 1
        elif "SH" in mods:
            inc["AB"] = 0
    return tuple(inc[c] for c in COLS)


def parse_zip(path, pairs, names, league):
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
                    pid, name, team, _, pos = f[1], f[2].strip('"'), int(f[3]), f[4], int(f[5])
                    names[pid] = name
                    if pos == 1:
                        pitcher[team] = pid
                elif kind == "play":
                    team, batter, event = int(f[2]), f[3], f[6]
                    p = pitcher[1 - team]
                    inc = classify(event)
                    if inc is None or p is None:
                        continue
                    row = pairs[(batter, p, year)]
                    for i, v in enumerate(inc):
                        row[i] += v
                    tot = league[year]
                    for i, v in enumerate(inc):
                        tot[i] += v


def main():
    zips = sorted(SRC.glob("*eve.zip"))
    if not zips:
        sys.exit(f"No *eve.zip files in {SRC}. Download them from https://www.retrosheet.org/events/")
    pairs = defaultdict(lambda: [0] * len(COLS))
    league = defaultdict(lambda: [0] * len(COLS))
    names = {}
    for z in zips:
        y = int(z.name[:4])
        if START <= y <= END:
            parse_zip(z, pairs, names, league)
            print("parsed", y, end="\r", flush=True)
    print()

    # ---- cross-check against the Lahman batting totals
    bat = pd.read_csv(ROOT / "data" / "batting.csv")
    lah = bat.groupby("year")[["AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF"]].sum()
    checks, worst = [], 0.0
    for y in sorted(league):
        row = {c: league[y][IDX[c]] for c in COLS}
        for c in ["AB", "H", "HR", "BB", "SO"]:
            diff = abs(row[c] - lah.loc[y, c]) / lah.loc[y, c]
            worst = max(worst, diff)
        checks.append({"year": y, **{c: row[c] for c in COLS}})
    print(f"Worst season-level difference vs Lahman (AB, H, HR, BB, SO): {worst:.4%}")

    # ---- cross-check the pitcher side against the Lahman pitching table
    # Compare hits, home runs, walks and strikeouts credited to each pitcher-season in the events
    # with the Lahman totals. The PA loop below only needs `pairs`, which is already complete.
    ppl = pd.read_csv(RAW / "People.csv", encoding="utf-8-sig")[["playerID", "retroID"]].dropna()
    to_lahman = dict(zip(ppl["retroID"], ppl["playerID"]))
    pit = pd.read_csv(RAW / "Pitching.csv").fillna(0)
    pit = pit[pit["yearID"] >= START].groupby(["playerID", "yearID"])[["H", "HR", "BB", "SO"]].sum()
    ev_p = defaultdict(lambda: [0] * len(COLS))
    for (b, p, y), v in pairs.items():
        for i, x in enumerate(v):
            ev_p[(p, y)][i] += x
    compared = exact = 0
    net = {"H": 0, "HR": 0, "BB": 0, "SO": 0}
    off_by_more_than_one = 0
    for (p, y), v in ev_p.items():
        lid = to_lahman.get(p)
        if lid is None or (lid, y) not in pit.index:
            continue
        L = pit.loc[(lid, y)]
        diffs = {k: v[IDX[k]] - int(L[k]) for k in net}
        compared += 1
        exact += all(d == 0 for d in diffs.values())
        off_by_more_than_one += any(abs(d) > 1 for d in diffs.values())
        for k, d in diffs.items():
            net[k] += d
    pitcher_check = {"pitcher_seasons_compared": compared, "pitcher_seasons_exact": exact,
                     "exact_share": round(exact / compared, 4), "seasons_off_by_more_than_one": off_by_more_than_one,
                     "net_difference_all_pitchers": net}
    print("Pitcher check:", pitcher_check)
    modern = [y for y in league if y >= 1970]
    modern_worst = max(abs(league[y][IDX[c]] - lah.loc[y, c]) / lah.loc[y, c] for y in modern for c in ["AB", "H", "HR", "BB", "SO"])

    # ---- keep pairs with enough career PA
    career = defaultdict(int)
    for (b, p, y), v in pairs.items():
        career[(b, p)] += v[0]
    keep = {k for k, v in career.items() if v >= MIN_CAREER_PA}
    rows = [(y, b, p, *v) for (b, p, y), v in pairs.items() if (b, p) in keep]
    rows.sort(key=lambda r: (r[1], r[2], r[0]))
    ids = sorted({r[1] for r in rows} | {r[2] for r in rows})
    num = {pid: i for i, pid in enumerate(ids)}
    out = pd.DataFrame([(y, num[b], num[p], *v) for y, b, p, *v in rows],
                       columns=["year", "b", "p"] + COLS)
    out.to_csv(ROOT / "data" / "matchups.csv", index=False)
    pd.DataFrame({"id": range(len(ids)), "retroID": ids, "name": [names.get(i, i) for i in ids]}) \
        .to_csv(ROOT / "data" / "matchup_players.csv", index=False)

    meta = {
        "years": [START, END], "min_career_pa": MIN_CAREER_PA,
        "all_pairs": len(career), "pairs_kept": len(keep), "rows": len(out), "players": len(ids),
        "plate_appearances_parsed": int(sum(v[0] for v in league.values())),
        "plate_appearances_kept": int(out["PA"].sum()),
        "worst_relative_difference_vs_lahman": round(worst, 6),
        "worst_relative_difference_1970_on": round(modern_worst, 8),
        "pitcher_check": pitcher_check,
        "season_totals": checks,
    }
    (ROOT / "data" / "matchups_meta.json").write_text(json.dumps(meta, indent=1))
    print(f"pairs total {len(career):,}; kept {len(keep):,} (>= {MIN_CAREER_PA} PA); rows {len(out):,}; players {len(ids):,}")
    print(f"matchups.csv {(ROOT / 'data' / 'matchups.csv').stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
