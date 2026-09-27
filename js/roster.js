/* ------------------------------------------------------------------
   roster.js: lets a reader pick any season + franchise on the report
   page and see every player's batting line for that team that year,
   with a team-total row at the bottom. Loads data/batting.csv
   independently of data/report.json.
------------------------------------------------------------------- */
let ROSTER_DATA = [];
let rosterSort = { key: "PA", dir: -1 };
let rosterRows = [], rosterTotal = null;

Papa.parse("data/batting.csv", {
  download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
  complete: res => {
    ROSTER_DATA = res.data.map(r => { SUM_COLS.forEach(c => (r[c] = +r[c] || 0)); r.year = +r.year; return r; });
    initRoster();
  },
  error: err => {
    document.getElementById("rosterStatus").textContent = "Could not load data/batting.csv. Run scripts/prep_data.py and serve the site through a web server.";
    console.error(err);
  },
});

function initRoster() {
  const years = [...new Set(ROSTER_DATA.map(r => r.year))].sort((a, b) => b - a);
  const franchises = [...new Set(ROSTER_DATA.map(r => r.franchise))].sort();
  document.getElementById("rosterYear").innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  document.getElementById("rosterFranchise").innerHTML = franchises.map(f => `<option value="${f}">${f}</option>`).join("");
  document.getElementById("rosterYear").value = years[0];
  document.getElementById("rosterFranchise").value = franchises[0];
  document.getElementById("rosterYear").addEventListener("change", drawRoster);
  document.getElementById("rosterFranchise").addEventListener("change", drawRoster);
  document.getElementById("rosterExport").addEventListener("click", exportRoster);
  drawRoster();
}

const ROSTER_COLS = [
  ["name", null], ["pos", null], ["bats", null], ["G", "int"], ["PA", "int"], ["AB", "int"], ["R", "int"],
  ["H", "int"], ["2B", "int"], ["3B", "int"], ["HR", "int"], ["RBI", "int"], ["SB", "int"], ["CS", "int"],
  ["BB", "int"], ["SO", "int"], ["AVG", "avg"], ["OBP", "avg"], ["SLG", "avg"], ["OPS", "avg"],
];
const ROSTER_HEAD = {
  name: "Player", pos: "Position", bats: "Bats", G: "G", PA: "PA", AB: "AB", R: "R", H: "H",
  "2B": "2B", "3B": "3B", HR: "HR", RBI: "RBI", SB: "SB", CS: "CS", BB: "BB", SO: "SO",
  AVG: "AVG", OBP: "OBP", SLG: "SLG", OPS: "OPS",
};

/* Adds the rate stats to a row (or a totals accumulator) without mutating the source */
function rosterRates(r) {
  const obp = OBP(r), slg = SLG(r);
  return { ...r, AVG: safeDiv(r.H, r.AB), OBP: obp, SLG: slg, OPS: obp == null || slg == null ? null : obp + slg };
}

function drawRoster() {
  const year = +document.getElementById("rosterYear").value;
  const franchise = document.getElementById("rosterFranchise").value;
  const rows = ROSTER_DATA.filter(r => r.year === year && r.franchise === franchise);

  rosterRows = rows.map(rosterRates);
  const { key, dir } = rosterSort;
  rosterRows.sort((a, b) => (typeof a[key] === "string"
    ? (a[key] || "").localeCompare(b[key] || "") * dir
    : ((a[key] ?? -1) - (b[key] ?? -1)) * dir));

  const t = emptyTotals();
  rows.forEach(r => addRow(t, r));
  rosterTotal = rosterRates({ ...t, name: "Team total", pos: "", bats: "" });

  document.getElementById("t-roster").textContent = rows.length ? `${franchise}, ${year}` : `${franchise}, ${year} — no rows`;
  document.getElementById("rosterStatus").textContent = rows.length
    ? `${fmt(rows.length, "int")} players combined for ${fmt(t.PA, "int")} plate appearances and a ${fmt(rosterTotal.AVG, "avg")} team average.`
    : "No player-seasons match this season and franchise.";

  const head = k => ROSTER_HEAD[k];
  document.getElementById("rosterTable").innerHTML = rows.length ? `
    <thead><tr>${ROSTER_COLS.map(([k]) => `<th data-k="${k}" tabindex="0" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${head(k)}</th>`).join("")}</tr></thead>
    <tbody>${rosterRows.map(r => `<tr>${ROSTER_COLS.map(([k, kind]) => `<td>${kind ? fmt(r[k], kind) : (r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${ROSTER_COLS.map(([k, kind]) => `<td>${kind ? fmt(rosterTotal[k], kind) : (rosterTotal[k] ?? "")}</td>`).join("")}</tr></tfoot>` : "";

  document.querySelectorAll("#rosterTable th").forEach(th => {
    const sort = () => {
      const k = th.dataset.k;
      rosterSort = { key: k, dir: rosterSort.key === k ? -rosterSort.dir : (["name", "pos", "bats"].includes(k) ? 1 : -1) };
      drawRoster();
    };
    th.addEventListener("click", sort);
    th.addEventListener("keydown", e => { if (e.key === "Enter") sort(); });
  });
}

function exportRoster() {
  if (!rosterRows.length) return;
  const head = k => ROSTER_HEAD[k];
  const out = [ROSTER_COLS.map(([k]) => head(k)), ...rosterRows.map(r => ROSTER_COLS.map(([k]) => r[k])), ROSTER_COLS.map(([k]) => rosterTotal[k])];
  downloadCSV(out, `roster-${document.getElementById("rosterFranchise").value}-${document.getElementById("rosterYear").value}`);
}
