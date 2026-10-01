/* ------------------------------------------------------------------
   roster_pitching.js: the pitching twin of roster.js. Lets a reader pick
   any season + franchise on the report page and see every pitcher's line
   for that team that year, with a team-total row at the bottom. Loads
   data/pitching.csv independently of data/report.json. Wrapped in a
   function so its names cannot collide with the hitting roster code.
   Rates are computed from totals, never as an average of pitchers' rates:
   ERA = 9 * ER / IP, WHIP = (BB + H) / IP, K/9 = 9 * SO / IP, BB/9 = 9 * BB / IP,
   where IP = outs recorded / 3 (shown in baseball notation, e.g. 200.1).
------------------------------------------------------------------- */
(function () {
const SUM = ["G", "GS", "CG", "SHO", "SV", "W", "L", "IPouts", "H", "R", "ER", "HR", "BB", "SO", "HBP", "BFP"];
let DATA = [];
let sort = { key: "IPouts", dir: -1 };
let rows = [], total = null;
const $ = id => document.getElementById(id);

/* the 4 MB file is only downloaded when a reader scrolls near this section */
function load() {
  $("rosterPStatus").textContent = "Loading pitcher rows…";
  Papa.parse("data/pitching.csv?v=" + DATA_VERSION, {
    download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
    complete: res => {
      DATA = res.data.map(r => { SUM.forEach(c => (r[c] = +r[c] || 0)); r.year = +r.year; return r; });
      init();
    },
    error: err => {
      $("rosterPStatus").textContent = "Could not load data/pitching.csv. Run scripts/prep_data.py and serve the site through a web server.";
      console.error(err);
    },
  });
}
whenNearViewport($("roster-pitching"), load);

function init() {
  const years = [...new Set(DATA.map(r => r.year))].sort((a, b) => b - a);
  const franchises = [...new Set(DATA.map(r => r.franchise))].sort();
  $("rosterPYear").innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join("");
  $("rosterPFranchise").innerHTML = franchises.map(f => `<option value="${f}">${f}</option>`).join("");
  $("rosterPYear").value = years[0];
  $("rosterPFranchise").value = franchises[0];
  $("rosterPYear").addEventListener("change", draw);
  $("rosterPFranchise").addEventListener("change", draw);
  $("rosterPExport").addEventListener("click", exportCsv);
  draw();
}

/* innings in baseball notation: 200 and one out is "200.1" */
const ipText = outs => `${Math.floor(outs / 3)}.${outs % 3}`;

/* [key, kind, header]; kind "ip" is innings in baseball notation */
const COLS = [
  ["name", null, "Pitcher"], ["role", null, "Role"], ["throws", null, "Throws"],
  ["G", "int", "G"], ["GS", "int", "GS"], ["W", "int", "W"], ["L", "int", "L"], ["SV", "int", "SV"], ["CG", "int", "CG"], ["SHO", "int", "SHO"],
  ["IPouts", "ip", "IP"], ["H", "int", "H"], ["R", "int", "R"], ["ER", "int", "ER"], ["HR", "int", "HR"], ["BB", "int", "BB"], ["SO", "int", "K"],
  ["ERA", "dec2", "ERA"], ["WHIP", "dec2", "WHIP"], ["K9", "dec2", "K/9"], ["BB9", "dec2", "BB/9"],
];
const safeDiv = (a, b) => (b ? a / b : null);

/* adds the rate stats to a row or totals object without changing the source */
function withRates(r) {
  const ip = r.IPouts / 3;
  return { ...r, ERA: safeDiv(9 * r.ER, ip), WHIP: safeDiv(r.BB + r.H, ip), K9: safeDiv(9 * r.SO, ip), BB9: safeDiv(9 * r.BB, ip) };
}
const cell = (r, [k, kind]) => (kind === "ip" ? ipText(r[k]) : kind ? fmt(r[k], kind) : (r[k] ?? ""));

function draw() {
  const year = +$("rosterPYear").value, franchise = $("rosterPFranchise").value;
  const picked = DATA.filter(r => r.year === year && r.franchise === franchise);

  rows = picked.map(withRates);
  const { key, dir } = sort;
  rows.sort((a, b) => (typeof a[key] === "string"
    ? (a[key] || "").localeCompare(b[key] || "") * dir
    : ((a[key] ?? -1) - (b[key] ?? -1)) * dir));

  const t = Object.fromEntries(SUM.map(c => [c, 0]));
  picked.forEach(r => SUM.forEach(c => (t[c] += r[c])));
  total = withRates({ ...t, name: "Team total", role: "", throws: "" });

  $("t-rosterP").textContent = picked.length ? `${franchise}, ${year}` : `${franchise}, ${year} — no rows`;
  $("rosterPStatus").textContent = picked.length
    ? `${fmt(picked.length, "int")} pitchers combined for ${ipText(t.IPouts)} innings, ${fmt(t.SO, "int")} strikeouts and a ${fmt(total.ERA, "dec2")} team ERA.`
    : "No pitcher-seasons match this season and franchise.";

  $("rosterPTable").innerHTML = picked.length ? `
    <thead><tr>${COLS.map(([k, , h]) => `<th data-k="${k}" tabindex="0" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(r => `<tr>${COLS.map(c => `<td>${cell(r, c)}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${COLS.map(c => `<td>${cell(total, c)}</td>`).join("")}</tr></tfoot>` : "";

  document.querySelectorAll("#rosterPTable th").forEach(th => {
    const go = () => {
      const k = th.dataset.k;
      sort = { key: k, dir: sort.key === k ? -sort.dir : (["name", "role", "throws"].includes(k) ? 1 : -1) };
      draw();
    };
    th.addEventListener("click", go);
    th.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  });
}

function exportCsv() {
  if (!rows.length) return;
  const val = (r, [k, kind]) => (kind === "ip" ? ipText(r[k]) : r[k]);
  const out = [COLS.map(c => c[2]), ...rows.map(r => COLS.map(c => val(r, c))), COLS.map(c => val(total, c))];
  downloadCSV(out, `pitchers-${$("rosterPFranchise").value}-${$("rosterPYear").value}`);
}
})();
