# The Evolution of MLB Hitting

A two-page data website built for FDA 2 (Financial Data Analytics). It studies every MLB batter's season from 1960 to 2025, using the 2025 Lahman release, and tracks how strikeouts, home runs, batting average and other measures changed over that time.

- **Live site:** https://logcheese03.github.io/mlb-batting-site/
- **Repository:** https://github.com/LogCheese03/mlb-batting-site
- **Author:** Logan Hull
- **Built with:** plain HTML, CSS and JavaScript (Chart.js and Papa Parse for charts and CSV loading), Python and pandas for data prep, and Claude Code as the coding assistant

## Data source

The [Lahman Baseball Database](https://sabr.org/lahman-database/), compiled by Sean Lahman and maintained with SABR, downloaded as CSV files. Using the 2025 release (covering 1871–2025), downloaded September 27, 2026.

Tables used: `Batting.csv`, `People.csv`, `Fielding.csv`, `Teams.csv` and `TeamsFranchises.csv`.

One row of `data/batting.csv` is one player's batting line for one team in one season. The time column is `year`, and the group column is `franchise`.

The cleaned file has 56,345 rows and 24 columns, covering 66 seasons (1960–2025) and 30 franchises. The categorical columns include `franchise`, `league`, `pos`, `bats` and `decade`, and the numeric columns include `PA`, `H`, `HR`, `RBI`, `SB`, `BB` and `SO`.

## Files

| File | What it does |
|---|---|
| `index.html` | Report page. It has the summary, headline numbers, ten findings with charts, a season/franchise roster explorer, and the data and methods section. |
| `dashboard.html` | Dashboard page. It has filters, summary numbers, five charts and a heatmap, measure and breakdown switches, a table and a reset button. |
| `css/style.css` | Shared fonts, colors and layout for both pages. |
| `js/common.js` | Shared formulas (AVG, OBP, SLG, OPS, rates), number formatting and chart styling. Its formulas match `scripts/prep_data.py`. |
| `js/report.js` | Loads `data/report.json`, fills in every number on the report and draws the report charts. Each finding links to a matching dashboard view. |
| `js/dashboard.js` | Loads `data/batting.csv`, applies filters, recalculates the numbers and draws the dashboard charts, heatmap and table. Also runs the player search, chart click-to-filter, and the `?measure=...&breakdown=...` deep links from the report. |
| `js/sound.js` | Optional synthesized hover/click sounds and a looping "Take Me Out to the Ball Game" chorus (both off by default; labeled buttons in the nav bar). |
| `js/roster.js` | Loads `data/batting.csv` on the report page and renders every player's line for a chosen season and franchise, with a team-total row. |
| `scripts/prep_data.py` | Reads the raw Lahman CSVs, joins franchise, batting hand and primary position, drops rows, checks the project requirements, and writes the two data files below. |
| `data/raw/` | The original Lahman CSV files (`Batting`, `People`, `Fielding`, `Teams`, `TeamsFranchises`), unchanged. |
| `data/batting.csv` | Cleaned data loaded by the dashboard, written by the script. |
| `data/report.json` | Every number and chart series on the report, written by the script. |
| `.gitignore` | Keeps macOS `.DS_Store` files out of the repository. |

## Reproduce the numbers

```bash
pip install pandas
python3 scripts/prep_data.py     # rebuilds data/batting.csv and data/report.json
python3 -m http.server 8000       # then open http://localhost:8000
```

The pages load their data with `fetch`, so opening the HTML files directly (`file://`) will not work. Use the local server above, or the GitHub Pages URL.

## Cleaning steps

1. Seasons before 1960 are excluded.
2. Missing counting stats are set to 0.
3. Rows with 0 plate appearances are dropped.
4. Team codes are mapped to franchises.
5. Primary position is the fielding position with the most games for that stint. Rows with no fielding record are labeled "DH / pinch hitter."

The script prints how many rows each step affects, and the report shows the same counts.
