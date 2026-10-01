"""
fetch_mlb_2026_pa.py
--------------------
Downloads every plate appearance of the 2026 regular season from MLB's public Stats API
(https://statsapi.mlb.com), one play-by-play feed per completed game, and writes them to
data/raw/mlb2026/pa_events.csv (one row per plate appearance: game, batter, pitcher, event).

Retrosheet has not published 2026 yet, so build_matchups.py reads this file for that season.
The feeds are requested with a `fields` filter so each response is small, and the script pauses
between requests. It can be stopped and re-run: games already saved are skipped.

Run from the repository root:
    python3 scripts/fetch_mlb_2026_pa.py
"""

from pathlib import Path
import csv
import json
import time
import urllib.parse
import urllib.request

SEASON = 2026
BASE = "https://statsapi.mlb.com/api/v1"
OUT = Path(__file__).resolve().parent.parent / "data" / "raw" / "mlb2026" / "pa_events.csv"
FIELDS = "allPlays,result,eventType,matchup,batter,id,pitcher,about,isComplete"


def get(path, **params):
    url = f"{BASE}/{path}?" + urllib.parse.urlencode(params, safe=",()[]=")
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                data = json.load(r)
            time.sleep(0.15)               # be polite to the API
            return data
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))


def main():
    sched = get("schedule", sportId=1, season=SEASON, gameType="R", startDate=f"{SEASON}-03-01", endDate=f"{SEASON}-10-05")
    games = [g["gamePk"] for d in sched["dates"] for g in d["games"] if g["status"]["abstractGameState"] == "Final"]
    games = sorted(set(games))
    print(len(games), "completed regular-season games")

    done = set()
    if OUT.exists():
        with open(OUT, newline="") as f:
            done = {int(r["game"]) for r in csv.DictReader(f)}
    new_file = not OUT.exists()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    todo = [g for g in games if g not in done]
    print(len(done), "games already saved;", len(todo), "to fetch")

    with open(OUT, "a", newline="") as f:
        w = csv.writer(f)
        if new_file:
            w.writerow(["game", "batter", "pitcher", "event"])
        for i, pk in enumerate(todo, 1):
            d = get(f"game/{pk}/playByPlay", fields=FIELDS)
            rows = []
            for p in d.get("allPlays", []):
                if not p.get("about", {}).get("isComplete", True):
                    continue
                m = p.get("matchup", {})
                ev = p.get("result", {}).get("eventType")
                if m.get("batter") and m.get("pitcher") and ev:
                    rows.append([pk, m["batter"]["id"], m["pitcher"]["id"], ev])
            w.writerows(rows)
            f.flush()
            if i % 50 == 0 or i == len(todo):
                print(f"  {i}/{len(todo)} games", end="\r", flush=True)
    print("\nwrote", OUT)


if __name__ == "__main__":
    main()
