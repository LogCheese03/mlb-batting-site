# MLB Hitting Over the Years

A two-page data website built for Financial Data Analytics. It studies every MLB batter's season from 1960 to the latest Lahman release.

- **Live site:** https://logcheese03.github.io/mlb-batting-site/
- **Author:** Logan

## Data source

The [Lahman Baseball Database](https://sabr.org/lahman-database/), compiled by Sean Lahman and maintained with SABR, downloaded as CSV files. Using the 2025 release (covering 1871–2025), downloaded September 27, 2026.

Tables used: `Batting.csv`, `People.csv`, `Fielding.csv`, `Teams.csv` and `TeamsFranchises.csv`.

One row of `data/batting.csv` is one player's batting line for one team in one season. The time column is `year`, and the group column is `franchise`.

## Files

| File | What it does |
|---|---|
| `index.html` | Report page. It has the summary, headline numbers, ten findings with charts, a season/franchise roster explorer, and the data and methods section. |
| `dashboard.html` | Dashboard page. It has filters, summary numbers, six charts with measure and breakdown switches, a table and a reset button. |
| `css/style.css` | Shared fonts, colors and layout for both pages. |
| `js/common.js` | Shared formulas (AVG, OBP, SLG, OPS, rates), number formatting and chart styling. Its formulas match `scripts/prep_data.py`. |
| `js/report.js` | Loads `data/report.json`, fills in every number on the report and draws the report charts. Each finding links to a matching dashboard view. |
| `js/dashboard.js` | Loads `data/batting.csv`, applies filters, recalculates the numbers and draws the dashboard charts, heatmap and table. Also runs the player search, chart click-to-filter, and the `?measure=...&breakdown=...` deep links from the report. |
| `js/sound.js` | Optional synthesized hover/click sounds (off by default; toggle button in the nav bar). |
| `js/roster.js` | Loads `data/batting.csv` on the report page and renders every player's line for a chosen season and franchise, with a team-total row. |
| `scripts/prep_data.py` | Reads the raw Lahman CSVs, joins franchise, batting hand and primary position, drops rows, checks the project requirements, and writes the two data files below. |
| `data/raw/` | The original Lahman CSV files, unchanged. |
| `data/batting.csv` | Cleaned data loaded by the dashboard, written by the script. |
| `data/report.json` | Every number and chart series on the report, written by the script. |

## Reproduce the numbers

```bash
pip install pandas
python scripts/prep_data.py      # rebuilds data/batting.csv and data/report.json
python -m http.server 8000        # then open http://localhost:8000
```

The pages load their data with `fetch`, so opening the HTML files directly (`file://`) will not work. Use the local server above, or the GitHub Pages URL.

## Cleaning steps

1. Seasons before 1960 are excluded.
2. Missing counting stats are set to 0.
3. Rows with 0 plate appearances are dropped.
4. Team codes are mapped to franchises.
5. Primary position is the fielding position with the most games for that stint. Rows with no fielding record are labeled "DH / pinch hitter."

The script prints how many rows each step affects, and the report shows the same counts.
