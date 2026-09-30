"""
prep_data.py
------------
Builds the data files the website uses from the raw Lahman Baseball Database CSVs.

Run from the repository root:
    python scripts/prep_data.py

Inputs  (put the Lahman CSVs anywhere under data/raw/):
    Batting.csv, Pitching.csv, People.csv, Fielding.csv, Teams.csv, TeamsFranchises.csv
Optional: data/raw/mlb2026/ (written by scripts/fetch_mlb_2026.py). When present, the 2026 regular
    season from MLB's Stats API is appended to the Lahman rows, because Lahman does not publish a
    season until after it ends. Rows are built with the same columns and cleaning rules.

Outputs:
    data/batting.csv   one row per batter, per team (stint), per season -> loaded by dashboard.html
    data/pitching.csv  one row per pitcher, per team (stint), per season -> loaded by pitching.html
    data/report.json   every number and chart series shown on index.html (hitting under the
                       top-level keys, pitching under "pitching")

Every rate is computed from TOTALS (sum of hits / sum of at-bats), never as an
average of player averages. dashboard.html uses the exact same formulas, so the
two pages agree.
"""

from pathlib import Path
import json
import re
import sys
import unicodedata

import pandas as pd

START_YEAR = 1960          # first season kept; change if you want a different window
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT_CSV = ROOT / "data" / "batting.csv"
OUT_PITCH_CSV = ROOT / "data" / "pitching.csv"
OUT_JSON = ROOT / "data" / "report.json"


# ---------------------------------------------------------------- loading
def find_file(name):
    """Find a Lahman CSV under data/raw regardless of folder or capitalization."""
    matches = [p for p in RAW.rglob("*.csv") if p.name.lower() == name.lower()]
    if not matches:
        sys.exit(f"Could not find {name} under {RAW}. Download the Lahman CSVs into data/raw/.")
    return matches[0]


def read_csv(name):
    path = find_file(name)
    try:
        df = pd.read_csv(path, low_memory=False, encoding="utf-8-sig")  # utf-8-sig strips byte-order marks
    except UnicodeDecodeError:
        df = pd.read_csv(path, low_memory=False, encoding="latin-1")
    df.columns = [c.replace("\ufeff", "").replace("ï»¿", "").strip() for c in df.columns]
    return df


def standardize_batting(df):
    """Different Lahman releases name a few columns differently. Normalize them."""
    rename = {"X2B": "2B", "X3B": "3B", "G_batting": "G"}
    df = df.rename(columns={k: v for k, v in rename.items() if k in df.columns and v not in df.columns})
    return df


# ---------------------------------------------------------------- formulas (mirror js/common.js)
def add_derived(df):
    df["PA"] = df["AB"] + df["BB"] + df["HBP"] + df["SF"] + df["SH"]
    df["TB"] = df["H"] + df["2B"] + 2 * df["3B"] + 3 * df["HR"]
    return df


def rates(t):
    """t is a dict or Series of column totals. Returns every rate the site reports."""
    ab, pa = t["AB"], t["PA"]
    obp_den = t["AB"] + t["BB"] + t["HBP"] + t["SF"]
    out = {
        "BA": t["H"] / ab if ab else None,
        "OBP": (t["H"] + t["BB"] + t["HBP"]) / obp_den if obp_den else None,
        "SLG": t["TB"] / ab if ab else None,
        "K_PCT": t["SO"] / pa if pa else None,
        "BB_PCT": t["BB"] / pa if pa else None,
        "HR_PCT": t["HR"] / pa if pa else None,
        "TTO_PCT": (t["HR"] + t["BB"] + t["SO"]) / pa if pa else None,
    }
    out["OPS"] = out["OBP"] + out["SLG"] if out["OBP"] is not None and out["SLG"] is not None else None
    return out


def r(x, n=4):
    return None if x is None or pd.isna(x) else round(float(x), n)


# ================================================================ 2026 season (MLB Stats API)
MLB_DIR = RAW / "mlb2026"
# MLB team id -> the franchise name the Lahman-based rows already use (so a franchise keeps one history)
MLB_FRANCHISE = {
    108: "Los Angeles Angels of Anaheim", 109: "Arizona Diamondbacks", 110: "Baltimore Orioles", 111: "Boston Red Sox",
    112: "Chicago Cubs", 113: "Cincinnati Reds", 114: "Cleveland Indians", 115: "Colorado Rockies", 116: "Detroit Tigers",
    117: "Houston Astros", 118: "Kansas City Royals", 119: "Los Angeles Dodgers", 120: "Washington Nationals",
    121: "New York Mets", 133: "Oakland Athletics", 134: "Pittsburgh Pirates", 135: "San Diego Padres",
    136: "Seattle Mariners", 137: "San Francisco Giants", 138: "St. Louis Cardinals", 139: "Tampa Bay Rays",
    140: "Texas Rangers", 141: "Toronto Blue Jays", 142: "Minnesota Twins", 143: "Philadelphia Phillies",
    144: "Atlanta Braves", 145: "Chicago White Sox", 146: "Florida Marlins", 147: "New York Yankees", 158: "Milwaukee Brewers",
}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}


def norm_name(text):
    """Lowercase, strip accents, punctuation and suffixes, so 'Ronald Acuña Jr.' matches 'Ronald Acuna'."""
    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    words = [w for w in re.sub(r"[^a-z ]", " ", text).split() if w not in SUFFIXES]
    return " ".join(words)


def mlb_id_map(people, mlb_players):
    """MLB player id -> Lahman playerID, matched on birth date and last name; unmatched get 'mlb<id>'."""
    p = people.dropna(subset=["birthYear", "birthMonth", "birthDay"]).copy()
    p["born"] = (p["birthYear"].astype(int).astype(str) + "-" + p["birthMonth"].astype(int).astype(str).str.zfill(2)
                 + "-" + p["birthDay"].astype(int).astype(str).str.zfill(2))
    by_born = {}
    for r in p.itertuples():
        by_born.setdefault(r.born, []).append(r)
    p["fullnorm"] = (p["nameFirst"].fillna("") + " " + p["nameLast"].fillna("")).map(norm_name)
    by_name_year = {}
    for r in p.itertuples():
        by_name_year.setdefault((r.fullnorm, int(r.birthYear)), []).append(r)
    mapping, matched = {}, 0
    for mid, rec in mlb_players.items():
        full = norm_name(rec["name"])
        first = full.split()[0] if full else ""
        hits = [r for r in by_born.get(rec["birthDate"], []) if norm_name(r.nameLast) and norm_name(r.nameLast) in full]
        if len(hits) > 1:          # twins or shared birthdays: narrow by first name, then first initial
            hits = [r for r in hits if norm_name(r.nameFirst) == first] or [r for r in hits if norm_name(r.nameFirst)[:1] == first[:1]] or hits
        if not hits and rec.get("birthDate"):   # birth dates can differ by a day between sources: same full name and year
            hits = by_name_year.get((full, int(rec["birthDate"][:4])), [])
        if len(hits) == 1:
            mapping[mid] = hits[0].playerID
            matched += 1
        else:
            mapping[mid] = f"mlb{mid}"
    return mapping, matched


def load_mlb_2026(people):
    """Return (hitting rows, pitching rows, log) for 2026 in the same columns as the Lahman-based rows."""
    if not (MLB_DIR / "players.json").exists():
        return None, None, {}
    players = json.loads((MLB_DIR / "players.json").read_text())
    teams = json.loads((MLB_DIR / "teams.json").read_text())
    fielding = json.loads((MLB_DIR / "fielding.json").read_text())
    meta = json.loads((MLB_DIR / "meta.json").read_text())
    ids, matched = mlb_id_map(people, players)
    lahman = people.set_index("playerID")

    # primary position = position with the most games for that player and team (LF + CF + RF count as OF)
    games = {}
    for f in fielding:
        pos = "OF" if f["pos"] in ("LF", "CF", "RF") else f["pos"]
        if pos == "DH":
            continue
        key = (str(f["playerId"]), f["teamId"])
        games.setdefault(key, {})
        games[key][pos] = games[key].get(pos, 0) + f["games"]
    pos_names = {"P": "Pitcher", "C": "Catcher", "1B": "First base", "2B": "Second base",
                 "3B": "Third base", "SS": "Shortstop", "OF": "Outfield"}

    def common(mid, rec, line):
        lid = ids[mid]
        name = (f"{lahman.at[lid, 'nameFirst']} {lahman.at[lid, 'nameLast']}".strip()
                if lid in lahman.index else rec["name"])
        team = line["teamId"]
        return {"year": 2026, "decade": "2020s", "playerID": lid, "name": name,
                "franchise": MLB_FRANCHISE[team], "league": "AL" if "American" in teams[str(team)]["league"] else "NL"}, lid

    hit_rows, pit_rows = [], []
    for mid, rec in players.items():
        for line in rec["hitting"]:
            base, lid = common(mid, rec, line)
            g = games.get((mid, line["teamId"]))
            pos = pos_names[max(g, key=g.get)] if g else "DH / pinch hitter"
            bats = (lahman.at[lid, "bats"] if lid in lahman.index else rec["bats"])
            bats = {"R": "Right", "L": "Left", "B": "Switch", "S": "Switch"}.get(bats, "Unknown")
            hit_rows.append({**base, "pos": pos, "bats": bats, **{k: line[k] for k in
                             ["G", "PA", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SH", "SF"]}})
        for line in rec["pitching"]:
            base, lid = common(mid, rec, line)
            throws = (lahman.at[lid, "throws"] if lid in lahman.index else rec["throws"])
            throws = {"R": "Right", "L": "Left", "S": "Switch"}.get(throws, "Unknown")
            role = "Starter" if line["GS"] * 2 >= line["G"] else "Reliever"
            pit_rows.append({**base, "role": role, "throws": throws, **{k: line[k] for k in
                             ["G", "GS", "CG", "SHO", "SV", "W", "L", "IPouts", "BFP", "H", "R", "ER", "HR", "BB", "SO", "HBP"]}})
    hit, pit = pd.DataFrame(hit_rows), pd.DataFrame(pit_rows)

    # cross-check: sum the player rows by team and compare with MLB's published team totals
    checks = exact = 0
    misses = set()
    tt_path = MLB_DIR / "team_totals.json"
    if tt_path.exists():
        team_totals = json.loads(tt_path.read_text())
        for group, frame in (("hitting", hit), ("pitching", pit)):
            for team, name in MLB_FRANCHISE.items():
                rows = frame[frame["franchise"] == name]
                for stat, published in team_totals[str(team)][group].items():
                    checks += 1
                    if int(rows[stat].sum()) == int(published):
                        exact += 1
                    else:
                        misses.add(f"{group}:{stat}")
    log = {"mlb2026_team_checks": checks, "mlb2026_team_checks_exact": exact,
           "mlb2026_team_check_misses": ", ".join(sorted(misses)), "mlb2026_players": len(players), "mlb2026_matched_to_lahman_id": matched,
           "mlb2026_hitting_rows_raw": len(hit), "mlb2026_pitching_rows_raw": len(pit),
           "mlb2026_fetched_utc": meta["fetched_utc"]}
    return hit, pit, log


# ---------------------------------------------------------------- build
def build():
    batting = standardize_batting(read_csv("Batting.csv"))
    people = read_csv("People.csv")
    fielding = read_csv("Fielding.csv")
    teams = read_csv("Teams.csv")
    franchises = read_csv("TeamsFranchises.csv")

    log = {}
    log["raw_rows"] = len(batting)

    # 1. Keep seasons from START_YEAR on
    df = batting[batting["yearID"] >= START_YEAR].copy()
    log["rows_in_window"] = len(df)

    # 2. Missing counting stats (a few older rows lack SF, HBP, CS, etc.) are treated as 0
    count_cols = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SH", "SF"]
    log["cells_filled_with_zero"] = int(df[count_cols].isna().sum().sum())
    df[count_cols] = df[count_cols].fillna(0).astype(int)
    df = add_derived(df)

    # 3. Drop rows with zero plate appearances (players on a roster who never batted)
    zero_pa = df["PA"] == 0
    log["rows_dropped_zero_pa"] = int(zero_pa.sum())
    df = df[~zero_pa].copy()

    # 4. Franchise: maps team codes that changed over time (e.g. MON -> WAS) to one group
    team_map = teams[["yearID", "teamID", "franchID"]].drop_duplicates()
    df = df.merge(team_map, on=["yearID", "teamID"], how="left")
    names = franchises[["franchID", "franchName"]].drop_duplicates("franchID")
    df = df.merge(names, on="franchID", how="left")
    df["franchName"] = df["franchName"].fillna(df["teamID"])

    # 5. Batting hand and player name
    ppl = people[["playerID", "nameFirst", "nameLast", "bats"]].copy()
    ppl["name"] = (ppl["nameFirst"].fillna("") + " " + ppl["nameLast"].fillna("")).str.strip()
    ppl["bats"] = ppl["bats"].map({"R": "Right", "L": "Left", "B": "Switch"}).fillna("Unknown")
    df = df.merge(ppl[["playerID", "name", "bats"]], on="playerID", how="left")
    df["bats"] = df["bats"].fillna("Unknown")

    # 6. Primary position = position with the most games for that player, season and stint
    f = fielding[fielding["yearID"] >= START_YEAR][["playerID", "yearID", "stint", "POS", "G"]].copy()
    f["G"] = f["G"].fillna(0)
    f = f.sort_values("G", ascending=False).drop_duplicates(["playerID", "yearID", "stint"])
    f = f.rename(columns={"POS": "pos"})[["playerID", "yearID", "stint", "pos"]]
    df = df.merge(f, on=["playerID", "yearID", "stint"], how="left")
    log["rows_without_fielding_record"] = int(df["pos"].isna().sum())
    df["pos"] = df["pos"].fillna("DH")  # batted but never took the field = designated / pinch hitter
    pos_names = {"P": "Pitcher", "C": "Catcher", "1B": "First base", "2B": "Second base",
                 "3B": "Third base", "SS": "Shortstop", "OF": "Outfield", "DH": "DH / pinch hitter"}
    df["pos"] = df["pos"].map(pos_names).fillna(df["pos"])

    df["decade"] = (df["yearID"] // 10 * 10).astype(str) + "s"

    out = df.rename(columns={"yearID": "year", "lgID": "league", "franchName": "franchise"})
    keep = ["year", "decade", "playerID", "name", "franchise", "league", "pos", "bats",
            "G", "PA", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SH", "SF"]
    out = out[keep].sort_values(["year", "franchise", "name"]).reset_index(drop=True)

    # 2026 regular season from the MLB Stats API (same columns, same cleaning rules)
    hit26, _, mlog = load_mlb_2026(people)
    if hit26 is not None:
        zero = hit26["PA"] == 0
        mlog["mlb2026_hitting_rows_dropped_zero_pa"] = int(zero.sum())
        hit26 = hit26[~zero]
        out = pd.concat([out, hit26[keep]], ignore_index=True)
        out = out.sort_values(["year", "franchise", "name"]).reset_index(drop=True)
        log.update(mlog)
    return out, log


# ---------------------------------------------------------------- validation
def validate(df):
    checks = {
        "rows >= 50,000": len(df) >= 50_000,
        "columns >= 8": df.shape[1] >= 8,
        "periods (seasons) >= 5": df["year"].nunique() >= 5,
        "groups (franchises) >= 10": df["franchise"].nunique() >= 10,
    }
    print("\nRequirement check")
    for k, ok in checks.items():
        print(f"  [{'OK' if ok else 'FAIL'}] {k}")
    print(f"  rows={len(df):,}  cols={df.shape[1]}  seasons={df['year'].nunique()}  "
          f"franchises={df['franchise'].nunique()}")
    if not all(checks.values()):
        print("\nAt least one requirement failed. Try an earlier START_YEAR.")


# ---------------------------------------------------------------- report numbers
SUM_COLS = ["PA", "AB", "H", "2B", "3B", "HR", "R", "RBI", "SB", "BB", "SO", "HBP", "SF", "SH"]


def totals(frame):
    t = frame[SUM_COLS].sum()
    t["TB"] = t["H"] + t["2B"] + 2 * t["3B"] + 3 * t["HR"]
    return t


def report(df, log):
    first, last = int(df["year"].min()), int(df["year"].max())
    rep = {"meta": {"start_year": first, "end_year": last, "rows": len(df), "columns": df.shape[1],
                    "seasons": int(df["year"].nunique()), "franchises": int(df["franchise"].nunique()),
                    "players": int(df["playerID"].nunique()), **log}}

    # By season
    season = []
    for yr, g in df.groupby("year"):
        t = totals(g)
        teams_in_year = g["franchise"].nunique()
        season.append({"year": int(yr), **{k: r(v) for k, v in rates(t).items()},
                       "HR": int(t["HR"]), "SO": int(t["SO"]), "SB": int(t["SB"]), "PA": int(t["PA"]),
                       "teams": int(teams_in_year),
                       "SB_PER_TEAM": r(t["SB"] / teams_in_year, 1),
                       "HR_PER_TEAM": r(t["HR"] / teams_in_year, 1)})
    rep["season"] = season

    # Season by league
    rep["league_season"] = [
        {"year": int(yr), "league": lg, **{k: r(v) for k, v in rates(totals(g)).items()}}
        for (yr, lg), g in df.groupby(["year", "league"])
    ]

    # Franchise home run totals
    fr = df.groupby("franchise").agg(HR=("HR", "sum"), PA=("PA", "sum"),
                                     seasons=("year", "nunique")).reset_index()
    fr["HR_PCT"] = fr["HR"] / fr["PA"]
    rep["franchise"] = [{"franchise": x.franchise, "HR": int(x.HR), "PA": int(x.PA),
                         "seasons": int(x.seasons), "HR_PCT": r(x.HR_PCT)}
                        for x in fr.sort_values("HR", ascending=False).itertuples()]

    # Position
    rep["position"] = [{"pos": p, "PA": int(totals(g)["PA"]), **{k: r(v) for k, v in rates(totals(g)).items()}}
                       for p, g in df.groupby("pos")]

    # Batting hand share of plate appearances by decade
    hand = df.groupby(["decade", "bats"])["PA"].sum().unstack(fill_value=0)
    share = hand.div(hand.sum(axis=1), axis=0)
    rep["bats_decade"] = {"decades": list(share.index),
                          "series": {c: [r(v) for v in share[c]] for c in share.columns}}

    # Doubles and triples per 600 plate appearances by decade
    dec = df.groupby("decade")[["2B", "3B", "PA"]].sum()
    rep["decade_xbh"] = [{"decade": d, "2B_PER_600": r(x["2B"] / x["PA"] * 600, 2),
                          "3B_PER_600": r(x["3B"] / x["PA"] * 600, 2)} for d, x in dec.iterrows()]

    # Headline numbers
    all_t = totals(df)
    s_first, s_last = season[0], season[-1]
    rep["headline"] = {
        "player_seasons": len(df),
        "total_HR": int(all_t["HR"]),
        "total_PA": int(all_t["PA"]),
        "BA_all": r(rates(all_t)["BA"]),
        "K_PCT_first": s_first["K_PCT"], "K_PCT_last": s_last["K_PCT"],
        "HR_PCT_first": s_first["HR_PCT"], "HR_PCT_last": s_last["HR_PCT"],
    }
    return rep


# ================================================================ pitching
# Rates mirror js/pitching.js. Innings are stored as outs (IPouts) so nothing is rounded:
# IP = IPouts / 3. Every rate is computed from totals, never as an average of pitchers' rates.
def build_pitching():
    pitching = read_csv("Pitching.csv")
    people = read_csv("People.csv")
    teams = read_csv("Teams.csv")
    franchises = read_csv("TeamsFranchises.csv")

    log = {"raw_rows": len(pitching)}

    df = pitching[pitching["yearID"] >= START_YEAR].copy()
    log["rows_in_window"] = len(df)

    count_cols = ["W", "L", "G", "GS", "CG", "SHO", "SV", "IPouts", "H", "R", "ER", "HR", "BB", "SO", "HBP", "BFP"]
    log["cells_filled_with_zero"] = int(df[count_cols].isna().sum().sum())
    df[count_cols] = df[count_cols].fillna(0).astype(int)

    zero = df["BFP"] == 0            # pitchers who never faced a batter
    log["rows_dropped_zero_bfp"] = int(zero.sum())
    df = df[~zero].copy()

    team_map = teams[["yearID", "teamID", "franchID"]].drop_duplicates()
    df = df.merge(team_map, on=["yearID", "teamID"], how="left")
    names = franchises[["franchID", "franchName"]].drop_duplicates("franchID")
    df = df.merge(names, on="franchID", how="left")
    df["franchName"] = df["franchName"].fillna(df["teamID"])

    ppl = people[["playerID", "nameFirst", "nameLast", "throws"]].copy()
    ppl["name"] = (ppl["nameFirst"].fillna("") + " " + ppl["nameLast"].fillna("")).str.strip()
    ppl["throws"] = ppl["throws"].map({"R": "Right", "L": "Left", "S": "Switch"}).fillna("Unknown")
    df = df.merge(ppl[["playerID", "name", "throws"]], on="playerID", how="left")
    df["throws"] = df["throws"].fillna("Unknown")

    # Role: a starter if he started at least half of the games he pitched for that team that season
    df["role"] = (df["GS"] * 2 >= df["G"]).map({True: "Starter", False: "Reliever"})
    df["decade"] = (df["yearID"] // 10 * 10).astype(str) + "s"

    out = df.rename(columns={"yearID": "year", "lgID": "league", "franchName": "franchise"})
    keep = ["year", "decade", "playerID", "name", "franchise", "league", "role", "throws",
            "G", "GS", "CG", "SHO", "SV", "W", "L", "IPouts", "BFP", "H", "R", "ER", "HR", "BB", "SO", "HBP"]
    out = out[keep].sort_values(["year", "franchise", "name"]).reset_index(drop=True)

    _, pit26, mlog = load_mlb_2026(people)
    if pit26 is not None:
        zero = pit26["BFP"] == 0
        log["mlb2026_pitching_rows_dropped_zero_bfp"] = int(zero.sum())
        pit26 = pit26[~zero]
        out = pd.concat([out, pit26[keep]], ignore_index=True)
        out = out.sort_values(["year", "franchise", "name"]).reset_index(drop=True)
    return out, log


P_SUM = ["G", "GS", "CG", "SHO", "SV", "W", "L", "IPouts", "BFP", "H", "R", "ER", "HR", "BB", "SO", "HBP"]


def p_rates(t):
    ip = t["IPouts"] / 3
    return {
        "ERA": 9 * t["ER"] / ip if ip else None,
        "WHIP": (t["BB"] + t["H"]) / ip if ip else None,
        "K9": 9 * t["SO"] / ip if ip else None,
        "BB9": 9 * t["BB"] / ip if ip else None,
        "HR9": 9 * t["HR"] / ip if ip else None,
        "H9": 9 * t["H"] / ip if ip else None,
        "K_PCT": t["SO"] / t["BFP"] if t["BFP"] else None,
        "BB_PCT": t["BB"] / t["BFP"] if t["BFP"] else None,
        "HR_PCT": t["HR"] / t["BFP"] if t["BFP"] else None,
        "K_BB": t["SO"] / t["BB"] if t["BB"] else None,
    }


def pitching_report(df, log):
    tot = lambda g: g[P_SUM].sum()
    first, last = int(df["year"].min()), int(df["year"].max())
    rep = {"meta": {"start_year": first, "end_year": last, "rows": len(df), "columns": df.shape[1],
                    "seasons": int(df["year"].nunique()), "franchises": int(df["franchise"].nunique()),
                    "pitchers": int(df["playerID"].nunique()), **log}}

    season = []
    for yr, g in df.groupby("year"):
        t = tot(g)
        teams_in_year = g["franchise"].nunique()
        st = g[g["role"] == "Starter"]
        rel = g[g["role"] == "Reliever"]
        season.append({"year": int(yr), **{k: r(v) for k, v in p_rates(t).items()},
                       "IP": r(t["IPouts"] / 3, 1), "SO": int(t["SO"]), "teams": int(teams_in_year),
                       "CG_PER_TEAM": r(t["CG"] / teams_in_year, 2),
                       "IP_PER_START": r(st["IPouts"].sum() / 3 / st["GS"].sum(), 2),
                       "RELIEF_SHARE": r(rel["IPouts"].sum() / t["IPouts"])})
    rep["season"] = season

    rep["league_season"] = [
        {"year": int(yr), "league": lg, **{k: r(v) for k, v in p_rates(tot(g)).items()}}
        for (yr, lg), g in df.groupby(["year", "league"])
    ]

    rep["franchise"] = [
        {"franchise": f, "IP": r(tot(g)["IPouts"] / 3, 1), "SO": int(tot(g)["SO"]),
         "seasons": int(g["year"].nunique()), **{k: r(v) for k, v in p_rates(tot(g)).items()}}
        for f, g in df.groupby("franchise")
    ]
    rep["franchise"].sort(key=lambda x: x["ERA"])

    # By decade: reliever share of innings, innings per start, share of innings thrown left-handed
    dec = []
    for d, g in df.groupby("decade"):
        st = g[g["role"] == "Starter"]
        dec.append({"decade": d,
                    "RELIEF_SHARE": r(g[g["role"] == "Reliever"]["IPouts"].sum() / g["IPouts"].sum()),
                    "IP_PER_START": r(st["IPouts"].sum() / 3 / st["GS"].sum(), 2),
                    "LEFT_SHARE": r(g[g["throws"] == "Left"]["IPouts"].sum() / g["IPouts"].sum())})
    rep["decade"] = dec

    all_t = tot(df)
    rep["headline"] = {
        "pitcher_seasons": len(df),
        "total_SO": int(all_t["SO"]),
        "total_IP": r(all_t["IPouts"] / 3, 0),
        "ERA_all": r(p_rates(all_t)["ERA"], 2),
        "K9_first": season[0]["K9"], "K9_last": season[-1]["K9"],
        "ERA_first": season[0]["ERA"], "ERA_last": season[-1]["ERA"],
    }
    return rep


def validate_pitching(df):
    print("\nPitching data check")
    print(f"  rows={len(df):,}  cols={df.shape[1]}  seasons={df['year'].nunique()}  "
          f"franchises={df['franchise'].nunique()}  pitchers={df['playerID'].nunique():,}")


def main():
    df, log = build()
    validate(df)
    OUT_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT_CSV, index=False)
    rep = report(df, log)

    pdf, plog = build_pitching()
    validate_pitching(pdf)
    pdf.to_csv(OUT_PITCH_CSV, index=False)
    rep["pitching"] = pitching_report(pdf, plog)
    OUT_JSON.write_text(json.dumps(rep, indent=1))
    print(f"\nWrote {OUT_CSV.relative_to(ROOT)} ({OUT_CSV.stat().st_size/1e6:.1f} MB)")
    print(f"Wrote {OUT_PITCH_CSV.relative_to(ROOT)} ({OUT_PITCH_CSV.stat().st_size/1e6:.1f} MB)")
    print(f"Wrote {OUT_JSON.relative_to(ROOT)}")
    print("\nCleaning log (hitting):")
    for k, v in log.items():
        print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")
    print("\nCleaning log (pitching):")
    for k, v in plog.items():
        print(f"  {k}: {v:,}" if isinstance(v, int) else f"  {k}: {v}")


if __name__ == "__main__":
    main()
