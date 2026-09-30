"""
fetch_mlb_2026.py
-----------------
Downloads the 2026 regular-season hitting, pitching and fielding lines from MLB's public Stats API
(https://statsapi.mlb.com) and saves trimmed copies under data/raw/mlb2026/. The Lahman database
does not include a season until it is published after that season ends, so this fills in 2026;
prep_data.py appends these rows to the Lahman rows when the files exist.

Run from the repository root:
    python3 scripts/fetch_mlb_2026.py

Files written (data/raw/mlb2026/):
    teams.json     MLB team id -> name, league
    players.json   one entry per player: name, birth date, bats, throws, and one hitting / pitching
                   line per team (a player traded during the season has one line per team)
    fielding.json  games played at each position, per player and team
    team_totals.json  MLB's own published team totals, used only to cross-check the player rows
    meta.json      when the data was fetched
"""

from datetime import datetime, timezone
from pathlib import Path
import json
import time
import urllib.parse
import urllib.request

SEASON = 2026
BASE = "https://statsapi.mlb.com/api/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "mlb2026"

HIT = {"gamesPlayed": "G", "plateAppearances": "PA", "atBats": "AB", "runs": "R", "hits": "H",
       "doubles": "2B", "triples": "3B", "homeRuns": "HR", "rbi": "RBI", "stolenBases": "SB",
       "caughtStealing": "CS", "baseOnBalls": "BB", "strikeOuts": "SO", "hitByPitch": "HBP",
       "sacBunts": "SH", "sacFlies": "SF"}
PIT = {"wins": "W", "losses": "L", "gamesPlayed": "G", "gamesStarted": "GS", "completeGames": "CG",
       "shutouts": "SHO", "saves": "SV", "hits": "H", "runs": "R", "earnedRuns": "ER", "homeRuns": "HR",
       "baseOnBalls": "BB", "strikeOuts": "SO", "hitBatsmen": "HBP", "battersFaced": "BFP"}


TEAM_HIT = {"plateAppearances": "PA", "atBats": "AB", "runs": "R", "hits": "H", "doubles": "2B", "triples": "3B",
            "homeRuns": "HR", "rbi": "RBI", "stolenBases": "SB", "baseOnBalls": "BB", "strikeOuts": "SO"}
TEAM_PIT = {"wins": "W", "losses": "L", "saves": "SV", "hits": "H", "earnedRuns": "ER", "homeRuns": "HR",
            "baseOnBalls": "BB", "strikeOuts": "SO", "battersFaced": "BFP", "completeGames": "CG"}


def get(path, **params):
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params, safe=",()[]=")
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                time.sleep(0.25)              # be polite to the API
                return json.load(r)
        except Exception as e:                # retry on network hiccups
            if attempt == 3:
                raise
            time.sleep(2 * (attempt + 1))


def outs(innings):
    """'5.1' innings pitched -> 16 outs. The digit after the point is outs (0, 1 or 2), not a tenth."""
    whole, _, frac = str(innings).partition(".")
    return int(whole) * 3 + int(frac or 0)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    teams = {t["id"]: {"name": t["name"], "league": t["league"]["name"]}
             for t in get("teams", sportId=1, season=SEASON)["teams"]}
    print(len(teams), "teams")

    # every player who has a regular-season hitting or pitching line
    ids = set()
    for group in ("hitting", "pitching"):
        d = get("stats", stats="season", group=group, season=SEASON, sportId=1, gameType="R",
                playerPool="ALL", limit=5000)
        ids |= {s["player"]["id"] for s in d["stats"][0]["splits"]}
    ids = sorted(ids)
    print(len(ids), "players")

    players = {}
    for i in range(0, len(ids), 50):
        chunk = ids[i:i + 50]
        d = get("people", personIds=",".join(map(str, chunk)),
                hydrate=f"stats(group=[hitting,pitching],type=[season],season={SEASON},gameType=R)")
        for p in d["people"]:
            rec = {"name": p["fullName"], "birthDate": p.get("birthDate"),
                   "bats": p.get("batSide", {}).get("code"), "throws": p.get("pitchHand", {}).get("code"),
                   "hitting": [], "pitching": []}
            for block in p.get("stats", []):
                group = block["group"]["displayName"]
                for sp in block.get("splits", []):
                    if "team" not in sp:      # the unlabeled split is the all-teams total; skip it
                        continue
                    st = sp["stat"]
                    if group == "hitting":
                        line = {v: st.get(k, 0) for k, v in HIT.items()}
                    elif group == "pitching":
                        line = {v: st.get(k, 0) for k, v in PIT.items()}
                        line["IPouts"] = outs(st.get("inningsPitched", "0.0"))
                    else:
                        continue
                    line["teamId"] = sp["team"]["id"]
                    rec[group].append(line)
            players[str(p["id"])] = rec
        print(f"  people {min(i + 50, len(ids))}/{len(ids)}", end="\r", flush=True)
    print()

    fielding = []
    d = get("stats", stats="season", group="fielding", season=SEASON, sportId=1, gameType="R",
            playerPool="ALL", limit=8000)
    for sp in d["stats"][0]["splits"]:
        if "team" in sp:
            fielding.append({"playerId": sp["player"]["id"], "teamId": sp["team"]["id"],
                             "pos": sp["position"]["abbreviation"], "games": sp["stat"].get("games", 0)})

    # MLB's published team totals (not used for the site's numbers, only to check the player rows)
    team_totals = {}
    for group, mapping in (("hitting", TEAM_HIT), ("pitching", TEAM_PIT)):
        d = get("teams/stats", season=SEASON, sportIds=1, group=group, stats="season", gameType="R")
        for sp in d["stats"][0]["splits"]:
            st = sp["stat"]
            row = {v: st.get(k, 0) for k, v in mapping.items()}
            if group == "pitching":
                row["IPouts"] = outs(st.get("inningsPitched", "0.0"))
            team_totals.setdefault(str(sp["team"]["id"]), {})[group] = row

    (OUT / "team_totals.json").write_text(json.dumps(team_totals, separators=(",", ":")))
    (OUT / "teams.json").write_text(json.dumps(teams, indent=1))
    (OUT / "players.json").write_text(json.dumps(players, separators=(",", ":")))
    (OUT / "fielding.json").write_text(json.dumps(fielding, separators=(",", ":")))
    (OUT / "meta.json").write_text(json.dumps({
        "season": SEASON, "source": "MLB Stats API (statsapi.mlb.com), regular season only",
        "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "players": len(players), "fielding_rows": len(fielding)}, indent=1))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
