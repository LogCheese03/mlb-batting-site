# The Evolution of MLB Hitting and Pitching

A data website built for FDA 2 (Financial Data Analytics). It studies every MLB batter's and pitcher's season from 1960 to 2026, using the 2025 Lahman release plus the 2026 regular season from MLB's Stats API, and tracks how strikeouts, home runs, ERA, complete games and other measures changed over that time. The report page is `index.html` and the main dashboard is `dashboard.html`; the site also has a pitching dashboard and a hitter-vs-pitcher matchup page.

- **Live site:** https://logcheese03.github.io/mlb-batting-site/
- **Repository:** https://github.com/LogCheese03/mlb-batting-site
- **Author:** Logan Hull
- **Built with:** plain HTML, CSS and JavaScript (Chart.js and Papa Parse for charts and CSV loading), Python and pandas for data prep, and Claude Code as the coding assistant

## Data source

The [Lahman Baseball Database](https://sabr.org/lahman-database/), compiled by Sean Lahman and maintained with SABR, downloaded as CSV files. Using the 2025 release (covering 1871–2025), downloaded September 27, 2026.

Tables used: `Batting.csv`, `Pitching.csv`, `People.csv`, `Fielding.csv`, `Teams.csv` and `TeamsFranchises.csv`.

The 2026 regular season is not in Lahman yet (a season is published after it ends), so it comes from MLB's public Stats API (`https://statsapi.mlb.com`), fetched by `scripts/fetch_mlb_2026.py` and merged by `prep_data.py`; see "The 2026 season" below.

The Matchups page uses another source, [Retrosheet](https://www.retrosheet.org) play-by-play event files for 1960–2025 (`https://www.retrosheet.org/events/YYYYeve.zip`), because Lahman has no batter-versus-pitcher data. *The information used here was obtained free of charge from and is copyrighted by Retrosheet. Interested parties may contact Retrosheet at 20 Sunset Rd., Newark, DE 19711.*

One row of `data/batting.csv` is one player's batting line for one team in one season. The time column is `year`, and the group column is `franchise`.

The pitching file, `data/pitching.csv`, has the same grain (one pitcher, one team, one season) with 38,416 rows and 24 columns. The hitting file meets the project's data requirements on its own; the pitching and matchup files are extras.

The cleaned hitting file has 57,084 rows and 24 columns, covering 67 seasons (1960–2026) and 30 franchises. The categorical columns include `franchise`, `league`, `pos`, `bats` and `decade`, and the numeric columns include `PA`, `H`, `HR`, `RBI`, `SB`, `BB` and `SO`.

## Files

| File | What it does |
|---|---|
| `index.html` | Report page. It has the summary, headline numbers, ten findings with charts, a season/franchise roster explorer, and the data and methods section. |
| `dashboard.html` | Hitting dashboard. It has filters, summary numbers (HR, R, RBI, AVG, SB and more), five charts and a heatmap, measure and breakdown switches, a table and a reset button. |
| `pitching.html` | Pitching dashboard, built the same way: filters (seasons, franchise, league, role, throws, minimum batters faced), summary numbers (W, K, SV, ERA, WHIP, K/9), five charts and a heatmap, switches, a table and a reset button. |
| `matchups.html` | Hitter-vs-pitcher page. Pick a hitter or a pitcher, see every opponent, then open one matchup for the season-by-season line, chart and table. |
| `css/style.css` | Shared fonts, colors and layout for both pages. |
| `js/common.js` | Shared formulas (AVG, OBP, SLG, OPS, rates), number formatting and chart styling. Its formulas match `scripts/prep_data.py`. |
| `js/report.js` | Loads `data/report.json`, fills in every number on the report and draws the report charts. Each finding links to a matching dashboard view. |
| `js/pitching.js` | Loads `data/pitching.csv` and does everything `dashboard.js` does for the pitching dashboard, with pitching formulas (ERA, WHIP, K/9 and so on). |
| `js/matchups.js` | Loads `data/matchups.csv` and `data/matchup_players.csv`, builds the hitter and pitcher indexes and draws the matchup page. |
| `js/dashboard.js` | Loads `data/batting.csv`, applies filters, recalculates the numbers and draws the dashboard charts, heatmap and table. Also runs the player search, chart click-to-filter, and the `?measure=...&breakdown=...` deep links from the report. |
| `js/sound.js` | Optional synthesized hover/click sounds and a looping "Take Me Out to the Ball Game" chorus (both off by default; labeled buttons in the nav bar). |
| `js/roster.js` | Loads `data/batting.csv` on the report page and renders every player's line for a chosen season and franchise, with a team-total row. |
| `scripts/prep_data.py` | Reads the raw Lahman CSVs, joins franchise, handedness and primary position or role, drops rows, checks the project requirements, and writes `batting.csv`, `pitching.csv` and `report.json`. |
| `scripts/fetch_mlb_2026.py` | Downloads the 2026 regular season from MLB's Stats API into `data/raw/mlb2026/` (player lines, positions, MLB's own team totals for a cross-check). |
| `scripts/build_matchups.py` | Reads Retrosheet play-by-play zips, classifies every plate appearance, credits it to the pitcher on the mound, checks the totals against Lahman, and writes the three matchup files below. |
| `data/raw/` | The original Lahman CSV files (`Batting`, `Pitching`, `People`, `Fielding`, `Teams`, `TeamsFranchises`), unchanged. |
| `data/raw/mlb2026/` | Trimmed copies of the MLB Stats API responses for 2026 (`players.json`, `fielding.json`, `teams.json`, `team_totals.json`, `meta.json`), so the 2026 rows can be rebuilt without the network. |
| `data/batting.csv` | Cleaned hitting data loaded by the hitting dashboard, written by the script. |
| `data/pitching.csv` | Cleaned pitching data loaded by the pitching dashboard, written by the script. |
| `data/matchups.csv` | One row per batter, pitcher and season for pairs with at least 20 career plate appearances against each other. |
| `data/matchup_players.csv` | Lookup from the numeric ids in `matchups.csv` to Retrosheet ids and names. |
| `data/matchups_meta.json` | Counts and the accuracy check for the matchup data (season totals against Lahman, pitcher totals against Lahman). |
| `data/report.json` | Every number and chart series on the report (hitting at the top level, pitching under `pitching`), written by the script. |
| `.gitignore` | Keeps macOS `.DS_Store` files out of the repository. |

## Reproduce the numbers

```bash
pip install pandas
python3 scripts/prep_data.py     # rebuilds data/batting.csv, data/pitching.csv and data/report.json
python3 -m http.server 8000       # then open http://localhost:8000
```

To rebuild the matchup files, download the yearly zips from Retrosheet into `data/retrosheet/` (about 125 MB, not committed) and run `python3 scripts/build_matchups.py`.

The pages load their data with `fetch`, so opening the HTML files directly (`file://`) will not work. Use the local server above, or the GitHub Pages URL.

## Cleaning steps

1. Seasons before 1960 are excluded.
2. Missing counting stats are set to 0.
3. Rows with 0 plate appearances are dropped.
4. Team codes are mapped to franchises.
5. Primary position is the fielding position with the most games for that stint. Rows with no fielding record are labeled "DH / pinch hitter."

The pitching data follows the same steps, plus one more: a pitcher is a starter for a team and season if he started at least half of his games, otherwise a reliever. The script prints how many rows each step affects, and the report shows the same counts.

## The 2026 season

Rows for 2026 are built from the MLB Stats API with the same columns and cleaning rules as the Lahman rows (zero-plate-appearance and zero-batter-faced lines are dropped; a pitcher is a starter if he started at least half his games; the primary position is the one with the most games, with LF, CF and RF combined as Outfield). Players are matched to their Lahman `playerID` by birth date and name so careers continue; players with no match, mostly 2026 debuts, keep an `mlb<id>` id. `prep_data.py` sums the player rows by team and compares them with MLB's own published team totals: 643 of 660 comparisons match exactly, and the only differences are in team earned runs, which are not always the sum of the pitchers' earned runs. The regular season ended September 27, 2026; postseason games are not included. The matchup page covers 1960–2025 only, because 2026 play-by-play is not published yet.

## How the matchup data was checked

`build_matchups.py` compares its event-based totals with Lahman and saves the result in `data/matchups_meta.json`. From 1970 on, season totals of AB, H, HR, BB and SO are within 0.01% of the Lahman batting totals. Retrosheet is missing some 1960s games, so those seasons run up to about 1% low. Pitcher-season hits, home runs, walks and strikeouts match the Lahman pitching table exactly for about 94% of 34,215 pitcher-seasons; most misses are a single walk that official scoring charges to a different pitcher than the one on the mound at the end.
