# The Evolution of MLB Hitting and Pitching

A data website built for FDA 2 (Financial Data Analytics). It studies every MLB batter's and pitcher's season from 1960 to 2026, using the 2025 Lahman release plus the 2026 regular season from MLB's Stats API, and tracks how strikeouts, home runs, ERA, complete games and other measures changed over that time. The report page is `index.html` and the main dashboard is `dashboard.html`; the site also has a pitching dashboard and a hitter-vs-pitcher matchup page that covers every pairing from 1960 through 2026.

- **Live site:** https://logcheese03.github.io/mlb-batting-site/
- **Repository:** https://github.com/LogCheese03/mlb-batting-site
- **Author:** Logan Hull
- **Built with:** plain HTML, CSS and JavaScript (Chart.js and Papa Parse for charts and CSV loading), Python and pandas for data prep, and Claude Code as the coding assistant

## Data source

The [Lahman Baseball Database](https://sabr.org/lahman-database/), compiled by Sean Lahman and maintained with SABR, downloaded as CSV files. Using the 2025 release (covering 1871–2025), downloaded September 27, 2026.

Tables used: `Batting.csv`, `Pitching.csv`, `People.csv`, `Fielding.csv`, `Teams.csv` (also for each team's park factor, `BPF`) and `TeamsFranchises.csv`.

The 2026 regular season is not in Lahman yet (a season is published after it ends), so it comes from MLB's public Stats API (`https://statsapi.mlb.com`), fetched by `scripts/fetch_mlb_2026.py` and merged by `prep_data.py`; see "The 2026 season" below.

The Matchups page uses other sources, because Lahman has no batter-versus-pitcher data: [Retrosheet](https://www.retrosheet.org) play-by-play event files for 1960–2025 (`https://www.retrosheet.org/events/YYYYeve.zip`) and MLB's own play-by-play feeds for 2026 (Retrosheet has not published 2026 yet). *The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.*

One row of `data/batting.csv` is one player's batting line for one team in one season. The time column is `year`, and the group column is `franchise`.

The pitching file, `data/pitching.csv`, has the same grain (one pitcher, one team, one season) with 38,416 rows and 24 columns. The hitting file meets the project's data requirements on its own; the pitching and matchup files are extras.

The cleaned hitting file has 57,084 rows and 24 columns, covering 67 seasons (1960–2026) and 30 franchises. The categorical columns include `franchise`, `league`, `pos`, `bats` and `decade`, and the numeric columns include `PA`, `H`, `HR`, `RBI`, `SB`, `BB` and `SO`.

## Files

| File | What it does |
|---|---|
| `README.md` | This file: what the project is, where the data came from, what every file does, how to rebuild the numbers, the cleaning steps and how the data was checked. |
| `index.html` | Report page. It has the summary and three big takeaways (the home run rate, strikeouts rising with home runs, and how ballparks shape pitching), headline numbers (a batting row and a pitching row), seventeen findings with charts, a season/franchise table of every hitter and another for every pitcher, and the data and methods section. |
| `dashboard.html` | Hitting dashboard. It has filters, summary numbers (HR, R, RBI, AVG, SB and more), five charts and a heatmap, measure and breakdown switches, a table and a reset button. |
| `pitching.html` | Pitching dashboard, built the same way: filters (seasons, franchise, league, role, throws, minimum batters faced), summary numbers (W, K, SV, ERA, WHIP, K/9), five charts and a heatmap, switches, a table and a reset button. |
| `matchups.html` | Hitter-vs-pitcher page. Search any hitter or pitcher, see every opponent they faced, then open one matchup for the season-by-season line, chart and table. |
| `grid.html` | Daily Grid game, like Immaculate Grid: a 3×3 grid of team, stat, position and era clues, with hitters and pitchers together in one grid each day. Name a player who fits both the row and the column; nine guesses, points for rarer picks, progress saved in the browser, and a copyable result. |
| `css/style.css` | Shared fonts, colors and layout for both pages. |
| `js/common.js` | Shared formulas (AVG, OBP, SLG, OPS, rates), number formatting and chart styling. Its formulas match `scripts/prep_data.py`. |
| `js/report.js` | Loads `data/report.json`, fills in every number on the report and draws the report charts. Each finding links to a matching dashboard view. |
| `js/pitching.js` | Loads `data/pitching.csv` and does everything `dashboard.js` does for the pitching dashboard, with pitching formulas (ERA, WHIP, K/9 and so on). |
| `js/matchups.js` | Loads `data/matchups/index.json` (every player), then the one file for the hitter or pitcher you pick, and draws the opponent list, charts and season-by-season table. |
| `js/dashboard.js` | Loads `data/batting.csv`, applies filters, recalculates the numbers and draws the dashboard charts, heatmap and table. Also runs the player search, chart click-to-filter, and the `?measure=...&breakdown=...` deep links from the report. |
| `js/grid.js` | Loads `data/grid.json`, builds the day's grid from a date-seeded random generator (so everyone gets the same one, with at least 3 valid players per square), checks guesses and scores them. |
| `js/sound.js` | Optional synthesized hover/click sounds and a looping "Take Me Out to the Ball Game" chorus (both off by default; labeled buttons in the nav bar). |
| `js/roster.js` | Loads `data/batting.csv` on the report page and renders every player's line for a chosen season and franchise, with a team-total row. |
| `js/roster_pitching.js` | Loads `data/pitching.csv` on the report page and renders every pitcher's line for a chosen season and franchise, with a team-total row (the pitching twin of `js/roster.js`). |
| `scripts/prep_data.py` | Reads the raw Lahman CSVs, joins franchise, handedness and primary position or role, drops rows, checks the project requirements, and writes `batting.csv`, `pitching.csv` and `report.json`. |
| `scripts/build_grid.py` | Reads `data/batting.csv` and `data/pitching.csv` and writes `data/grid.json`: one pool of every hitter and pitcher, with a clue list (teams, season and career milestones, positions, handedness, decades) and, for each player, the clues they meet. |
| `scripts/fetch_mlb_2026.py` | Downloads the 2026 regular season from MLB's Stats API into `data/raw/mlb2026/` (player lines, positions, MLB's own team totals for a cross-check). |
| `scripts/fetch_mlb_2026_pa.py` | Downloads every 2026 plate appearance (batter, pitcher, event) from MLB's play-by-play feeds into `data/raw/mlb2026/pa_events.csv`. |
| `scripts/build_matchups.py` | Reads the Retrosheet zips (1960–2025) and the 2026 feed, classifies every plate appearance, credits it to the pitcher on the mound, checks the totals against this site's hitting and pitching files, and writes the matchup files below. |
| `data/raw/` | The original Lahman CSV files (`Batting`, `Pitching`, `People`, `Fielding`, `Teams`, `TeamsFranchises`), unchanged. |
| `data/raw/mlb2026/` | Trimmed copies of the MLB Stats API responses for 2026 (`players.json`, `fielding.json`, `teams.json`, `team_totals.json`, `meta.json`) and every 2026 plate appearance (`pa_events.csv`), so the 2026 rows can be rebuilt without the network. |
| `data/batting.csv` | Cleaned hitting data loaded by the hitting dashboard, written by the script. |
| `data/pitching.csv` | Cleaned pitching data loaded by the pitching dashboard, written by the script. |
| `data/matchups/` | `index.json` lists every player; `b/<id>.csv` has one file per hitter and `p/<id>.csv` one per pitcher, each with every opponent faced, season by season (17,287 files). Loaded one at a time by the matchup page. |
| `data/matchups_meta.json` | Counts and the accuracy check for the matchup data (season totals against Lahman, pitcher totals against Lahman). |
| `data/grid.json` | Clues and player eligibility for the Daily Grid game, written by `scripts/build_grid.py`. |
| `data/report.json` | Every number and chart series on the report (hitting at the top level, pitching under `pitching`, average park factors under `park`), written by the script. |
| `.gitignore` | Keeps macOS `.DS_Store` files out of the repository. |

## Reproduce the numbers

```bash
pip install pandas
python3 scripts/prep_data.py     # rebuilds data/batting.csv, data/pitching.csv and data/report.json
python3 -m http.server 8000       # then open http://localhost:8000
```

To rebuild the matchup files, download the yearly zips from Retrosheet into `data/retrosheet/` (1960–2025, about 125 MB, not committed) and run `python3 scripts/build_matchups.py` (about two minutes and 4 GB of memory). `python3 scripts/fetch_mlb_2026_pa.py` rebuilds the 2026 plate-appearance file from MLB's feeds (about 25 minutes).

To rebuild the Daily Grid data, run `python3 scripts/build_grid.py` after `prep_data.py` (a few seconds).

The pages load their data with `fetch`, so opening the HTML files directly (`file://`) will not work. Use the local server above, or the GitHub Pages URL.

## Cleaning steps

1. Seasons before 1960 are excluded.
2. Missing counting stats are set to 0.
3. Rows with 0 plate appearances are dropped.
4. Team codes are mapped to franchises.
5. Primary position is the fielding position with the most games for that stint. Rows with no fielding record are labeled "DH / pinch hitter."

The pitching data follows the same steps, plus one more: a pitcher is a starter for a team and season if he started at least half of his games, otherwise a reliever. The script prints how many rows each step affects, and the report shows the same counts.

## The 2026 season

Rows for 2026 are built from the MLB Stats API with the same columns and cleaning rules as the Lahman rows (zero-plate-appearance and zero-batter-faced lines are dropped; a pitcher is a starter if he started at least half his games; the primary position is the one with the most games, with LF, CF and RF combined as Outfield). Players are matched to their Lahman `playerID` by birth date and name so careers continue; players with no match, mostly 2026 debuts, keep an `mlb<id>` id. `prep_data.py` sums the player rows by team and compares them with MLB's own published team totals: 643 of 660 comparisons match exactly, and the only differences are in team earned runs, which are not always the sum of the pitchers' earned runs. The regular season ended September 27, 2026; postseason games are not included.

## How the matchup data was checked

Every hitter-pitcher pairing is kept: 12,686 players, 2,045,346 pairs and 3,739,725 season rows (10.8 million plate appearances). `build_matchups.py` checks its totals against this site's own hitting and pitching files and saves the results in `data/matchups_meta.json`:

- **Seasons:** from 1970 on, the season totals of AB, H, HR, BB and SO are within 0.01% of the hitting file, and 2026 matches exactly. Retrosheet is missing some 1960s games, so those seasons run low (1968 is the worst, at 99.1% of at-bats).
- **Hitters:** hits, home runs, walks and strikeouts match the hitting file exactly in 97.0% of 53,353 hitter-seasons.
- **Pitchers:** the same four numbers match the pitching file exactly in 94.0% of 35,083 pitcher-seasons. Most misses are a single walk that official scoring charges to a different pitcher than the one on the mound at the end.
- **2026:** 2,429 completed regular-season games (one game was cancelled) and 183,849 plate appearances. Pickoffs, steals and other events that do not end a plate appearance are ignored.
