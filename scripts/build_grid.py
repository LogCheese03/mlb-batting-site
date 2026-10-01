"""Build data/grid.json for the daily Grid game (grid.html).

Reads the cleaned data/batting.csv and data/pitching.csv and writes, for hitters and
pitchers separately, a list of criteria (teams, season milestones, career milestones,
positions, handedness) and a list of players, each with the criteria they meet.
The browser picks each day's nine criteria and checks guesses against this file.
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TEAM_SHORT = {
    "Atlanta Braves": "Braves", "Baltimore Orioles": "Orioles", "Boston Red Sox": "Red Sox",
    "Chicago Cubs": "Cubs", "Chicago White Sox": "White Sox", "Cincinnati Reds": "Reds",
    "Cleveland Indians": "Guardians/Indians", "Detroit Tigers": "Tigers",
    "Los Angeles Dodgers": "Dodgers", "Minnesota Twins": "Twins", "New York Yankees": "Yankees",
    "Oakland Athletics": "Athletics", "Philadelphia Phillies": "Phillies",
    "Pittsburgh Pirates": "Pirates", "San Francisco Giants": "Giants",
    "St. Louis Cardinals": "Cardinals", "Los Angeles Angels of Anaheim": "Angels",
    "Texas Rangers": "Rangers", "Houston Astros": "Astros", "New York Mets": "Mets",
    "Kansas City Royals": "Royals", "Milwaukee Brewers": "Brewers", "San Diego Padres": "Padres",
    "Washington Nationals": "Nationals/Expos", "Seattle Mariners": "Mariners",
    "Toronto Blue Jays": "Blue Jays", "Colorado Rockies": "Rockies",
    "Florida Marlins": "Marlins", "Arizona Diamondbacks": "D-backs", "Tampa Bay Rays": "Rays",
}

# MLB team ids, used by the browser for the team-logo fallback (https://www.mlbstatic.com/team-logos/<id>.svg)
TEAM_ID = {
    "Atlanta Braves": 144, "Baltimore Orioles": 110, "Boston Red Sox": 111, "Chicago Cubs": 112,
    "Chicago White Sox": 145, "Cincinnati Reds": 113, "Cleveland Indians": 114, "Detroit Tigers": 116,
    "Los Angeles Dodgers": 119, "Minnesota Twins": 142, "New York Yankees": 147, "Oakland Athletics": 133,
    "Philadelphia Phillies": 143, "Pittsburgh Pirates": 134, "San Francisco Giants": 137,
    "St. Louis Cardinals": 138, "Los Angeles Angels of Anaheim": 108, "Texas Rangers": 140,
    "Houston Astros": 117, "New York Mets": 121, "Kansas City Royals": 118, "Milwaukee Brewers": 158,
    "San Diego Padres": 135, "Washington Nationals": 120, "Seattle Mariners": 136, "Toronto Blue Jays": 141,
    "Colorado Rockies": 115, "Florida Marlins": 146, "Arizona Diamondbacks": 109, "Tampa Bay Rays": 139,
}

MIN_PLAYERS = 40  # a criterion with fewer matching players is too thin to use


def season_sum(df, cols):
    """One row per player-season (a traded player's stints are added together)."""
    return df.groupby(["playerID", "year"], as_index=False)[cols].sum()


def build(kind):
    if kind == "hit":
        df = pd.read_csv(DATA / "batting.csv")
        num = ["G", "PA", "AB", "H", "HR", "RBI", "SB", "R", "BB", "2B"]
    else:
        df = pd.read_csv(DATA / "pitching.csv")
        num = ["G", "GS", "SV", "W", "SO", "IPouts", "ER", "SHO", "CG"]
    seas = season_sum(df, num)
    car = df.groupby("playerID")[num].sum()
    # (id, label, group, kind, boolean Series of playerIDs meeting it)
    crit = []

    def add(cid, label, group, ctype, ids):
        ids = set(ids)
        if len(ids) >= MIN_PLAYERS:
            crit.append({"id": cid, "label": label, "group": group, "type": ctype, "ids": ids})

    for team, short in TEAM_SHORT.items():
        add("team:" + team, short, "team", "team", df.loc[df.franchise == team, "playerID"])

    def season(cid, label, group, mask):
        add(cid, label, group, "stat", seas.loc[mask, "playerID"])

    def career(cid, label, group, mask):
        add(cid, label, group, "stat", car.index[mask])

    if kind == "hit":
        season("s_hr30", "30+ HR in a season", "hr", seas.HR >= 30)
        season("s_hr40", "40+ HR in a season", "hr", seas.HR >= 40)
        season("s_rbi100", "100+ RBI in a season", "rbi", seas.RBI >= 100)
        season("s_h200", "200+ hits in a season", "h", seas.H >= 200)
        season("s_sb30", "30+ SB in a season", "sb", seas.SB >= 30)
        season("s_sb50", "50+ SB in a season", "sb", seas.SB >= 50)
        season("s_avg300", ".300+ AVG in a season (400+ PA)", "avg",
               (seas.PA >= 400) & (seas.H / seas.AB.where(seas.AB > 0) >= 0.300))
        season("s_r100", "100+ runs in a season", "r", seas.R >= 100)
        season("s_bb100", "100+ walks in a season", "bb", seas.BB >= 100)
        season("s_2b40", "40+ doubles in a season", "2b", seas["2B"] >= 40)
        career("c_hr300", "300+ career HR", "hr", car.HR >= 300)
        career("c_hr200", "200+ career HR", "hr", car.HR >= 200)
        career("c_h2000", "2,000+ career hits", "h", car.H >= 2000)
        career("c_h1500", "1,500+ career hits", "h", car.H >= 1500)
        career("c_rbi1000", "1,000+ career RBI", "rbi", car.RBI >= 1000)
        career("c_sb200", "200+ career SB", "sb", car.SB >= 200)
        career("c_g1500", "1,500+ career games", "g", car.G >= 1500)
        for pos in ["Catcher", "First base", "Second base", "Third base", "Shortstop", "Outfield"]:
            add("pos:" + pos, "Played " + pos.lower(), "pos", "pos", df.loc[df.pos == pos, "playerID"])
        add("bats:Left", "Bats left-handed", "bats", "hand", df.loc[df.bats == "Left", "playerID"])
        add("bats:Switch", "Switch hitter", "bats", "hand", df.loc[df.bats == "Switch", "playerID"])
        add("pitched", "Also pitched in the majors", "role", "pos", pd.read_csv(DATA / "pitching.csv").playerID)
    else:
        season("s_w15", "15+ wins in a season", "w", seas.W >= 15)
        season("s_w20", "20+ wins in a season", "w", seas.W >= 20)
        season("s_k200", "200+ strikeouts in a season", "k", seas.SO >= 200)
        season("s_k250", "250+ strikeouts in a season", "k", seas.SO >= 250)
        season("s_sv30", "30+ saves in a season", "sv", seas.SV >= 30)
        season("s_sv40", "40+ saves in a season", "sv", seas.SV >= 40)
        season("s_era3", "Sub-3.00 ERA in a season (162+ IP)", "era",
               (seas.IPouts >= 486) & (27 * seas.ER / seas.IPouts.where(seas.IPouts > 0) < 3.0))
        season("s_ip200", "200+ innings in a season", "ip", seas.IPouts >= 600)
        season("s_cg10", "10+ complete games in a season", "cg", seas.CG >= 10)
        season("s_sho4", "4+ shutouts in a season", "sho", seas.SHO >= 4)
        career("c_w150", "150+ career wins", "w", car.W >= 150)
        career("c_w100", "100+ career wins", "w", car.W >= 100)
        career("c_k1500", "1,500+ career strikeouts", "k", car.SO >= 1500)
        career("c_k1000", "1,000+ career strikeouts", "k", car.SO >= 1000)
        career("c_sv200", "200+ career saves", "sv", car.SV >= 200)
        career("c_sv100", "100+ career saves", "sv", car.SV >= 100)
        career("c_g500", "500+ career games", "g", car.G >= 500)
        add("role:Starter", "Started 20+ games in a season", "role", "pos",
            seas.loc[seas.GS >= 20, "playerID"])
        add("role:Closer", "Reliever with 20+ saves in a season", "role", "pos",
            seas.loc[seas.SV >= 20, "playerID"])
        add("throws:Left", "Throws left-handed", "hand", "hand", df.loc[df.throws == "Left", "playerID"])
        add("batted", "Also batted in the majors (100+ PA)", "role", "pos",
            pd.read_csv(DATA / "batting.csv").groupby("playerID").PA.sum().loc[lambda s: s >= 100].index)

    # Decades: played at least one season in that decade.
    for dec in range(1960, 2030, 10):
        add(f"dec:{dec}", f"Played in the {dec}s", "dec", "era",
            df.loc[(df.year >= dec) & (df.year < dec + 10), "playerID"])

    players = (df.groupby("playerID")
               .agg(name=("name", "last"), first=("year", "min"), last=("year", "max"))
               .join(car[["G"]]))
    # Volume used to rate how obscure a player is: plate appearances or innings pitched.
    players["vol"] = (car["PA"] if kind == "hit" else (car["IPouts"] / 3)).round().astype(int)
    index = {pid: i for i, pid in enumerate(players.index)}
    met = [[] for _ in players.index]
    for ci, c in enumerate(crit):
        for pid in c["ids"]:
            if pid in index:
                met[index[pid]].append(ci)
    out_players = [[pid, r["name"], int(r["first"]), int(r["last"]), int(r["vol"]), met[index[pid]]]
                   for pid, r in players.iterrows()]
    return {
        "criteria": [{k: c[k] for k in ("id", "label", "group", "type")} | {"n": len(c["ids"])} for c in crit],
        "players": out_players,
    }


def mlbam_ids():
    """playerID -> MLB id (from scripts/fetch_mlbam_ids.py), used for the headshot shown after a correct guess."""
    path = DATA / "raw" / "mlbam_ids.csv"
    if not path.exists():
        return {}
    df = pd.read_csv(path, dtype=str)
    return {r.playerID: r.mlbam for r in df.itertuples() if r.photo == "1"}   # only players MLB really has a photo for


def main_team():
    """playerID -> MLB id of the franchise the player appeared in most (games), hitting and pitching together."""
    both = pd.concat([pd.read_csv(DATA / "batting.csv", usecols=["playerID", "franchise", "G"]),
                      pd.read_csv(DATA / "pitching.csv", usecols=["playerID", "franchise", "G"])])
    g = both.groupby(["playerID", "franchise"], as_index=False).G.sum().sort_values("G")
    return {r.playerID: TEAM_ID[r.franchise] for r in g.itertuples()}   # last row per player wins = most games


def merge(hit, pit):
    """One pool of every player: team and era clues are shared, hitting and pitching clues sit side by side."""
    skip = {"pitched", "batted"}  # "also pitched/batted" only make sense inside one pool
    crit, index, players = [], {}, {}
    for part in (hit, pit):
        remap = {}
        for ci, c in enumerate(part["criteria"]):
            if c["id"] in skip:
                continue
            if c["id"] not in index:
                index[c["id"]] = len(crit)
                crit.append({k: c[k] for k in ("id", "label", "group", "type")})
            remap[ci] = index[c["id"]]
        for pid, name, first, last, vol, met in part["players"]:
            p = players.setdefault(pid, [pid, name, first, last, 0, set(), 0, 0])
            p[2], p[3] = min(p[2], first), max(p[3], last)
            p[4] += vol
            p[5].update(remap[m] for m in met if m in remap)
            p[6 if part is hit else 7] = vol
    for cid, label, test in [("role:hitter", "Mainly a hitter (1,000+ career PA)", lambda p: p[6] >= 1000),
                             ("role:pitcher", "Pitcher (300+ career innings)", lambda p: p[7] >= 300)]:
        index[cid] = len(crit)
        crit.append({"id": cid, "label": label, "group": "kind", "type": "pos"})
        for p in players.values():
            if test(p):
                p[5].add(index[cid])
    counts = [0] * len(crit)
    for p in players.values():
        for m in p[5]:
            counts[m] += 1
    for c, n in zip(crit, counts):
        c["n"] = n
    ids, team = mlbam_ids(), main_team()
    return {"criteria": crit,
            "players": [[p[0], p[1], p[2], p[3], p[4], sorted(p[5]), int(ids.get(p[0], 0)), team.get(p[0], 0)] for p in players.values()]}


def main():
    hit, pit = build("hit"), build("pit")
    out = {"all": merge(hit, pit)}
    path = DATA / "grid.json"
    path.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    for k in out:
        print(k, len(out[k]["criteria"]), "criteria,", len(out[k]["players"]), "players")
    print(path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
