/* ------------------------------------------------------------------
   matchups.js: batter-vs-pitcher lookup, season by season.
   Loads data/matchups.csv (one row per batter, pitcher and season for
   pairs with at least 20 career plate appearances) built by
   scripts/build_matchups.py from Retrosheet play-by-play files.
   Rates use the same formulas as the rest of the site, computed from
   totals: AVG = H / AB, OBP = (H + BB + HBP) / (AB + BB + HBP + SF),
   SLG = (H + 2B + 2*3B + 3*HR) / AB, OPS = OBP + SLG.
------------------------------------------------------------------- */
(function () {
applyChartTheme();

const COLS = ["PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF"];
const $ = id => document.getElementById(id);

let N = 0;                    // number of rows
const col = {};               // column name -> Int32Array
let PLAYERS = [];             // id -> { name, first, last }
let byB = new Map();          // batter id  -> [{ o: pitcher id, s: start row, e: end row (exclusive) }]
let byP = new Map();          // pitcher id -> [{ o: batter id,  s, e }]
let TOP_PAIRS = [];
const state = { mode: "hitter", primary: null, opp: null, measure: "OPS", minPA: 20, sort: { key: "PA", dir: -1 } };
let chart = null, oppChart = null, oppRows = [], seasonRows = [];

/* ---------------- load ---------------- */
Promise.all([
  fetch("data/matchup_players.csv?v=" + DATA_VERSION).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
  fetch("data/matchups.csv?v=" + DATA_VERSION).then(r => { if (!r.ok) throw new Error(r.status); return r.text(); }),
]).then(([playersText, rowsText]) => {
  parsePlayers(playersText);
  parseRows(rowsText);
  init();
  $("loading").hidden = true;
}).catch(err => {
  $("loading").textContent = "Could not load the matchup data (" + err.message + "). Serve the site through a web server; see the README.";
  console.error(err);
});

/* accuracy note: numbers come from data/matchups_meta.json, written by build_matchups.py */
fetch("data/matchups_meta.json?v=" + DATA_VERSION).then(r => r.json()).then(m => {
  const pct2 = v => (v * 100).toFixed(2) + "%", pct1 = v => (v * 100).toFixed(1) + "%";
  $("mmTol").textContent = pct2(Math.max(m.worst_relative_difference_1970_on, 0.0001));
  $("mmWorst").textContent = pct2(m.worst_relative_difference_vs_lahman);
  $("mmExact").textContent = pct1(m.pitcher_check.exact_share);
}).catch(() => {});

function parsePlayers(text) {
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  PLAYERS = [];
  res.data.forEach(r => { PLAYERS[+r.id] = { name: r.name, retro: r.retroID, first: 9999, last: 0 }; });
}

function parseRows(text) {
  const lines = text.split("\n");
  const head = lines[0].trim().split(",");
  const n = lines.length;
  head.forEach(h => (col[h] = new Int32Array(n)));
  let i = 0;
  for (let li = 1; li < lines.length; li++) {
    const line = lines[li]; if (!line) continue;
    const f = line.split(",");
    for (let k = 0; k < head.length; k++) col[head[k]][i] = +f[k];
    i++;
  }
  N = i;
  // rows are sorted by batter, then pitcher, then year, so each pair is one contiguous block
  byB = new Map(); byP = new Map();
  let s = 0;
  const pairs = [];
  for (let r = 1; r <= N; r++) {
    if (r === N || col.b[r] !== col.b[s] || col.p[r] !== col.p[s]) {
      const b = col.b[s], p = col.p[s];
      if (!byB.has(b)) byB.set(b, []);
      if (!byP.has(p)) byP.set(p, []);
      byB.get(b).push({ o: p, s, e: r });
      byP.get(p).push({ o: b, s, e: r });
      let pa = 0; for (let k = s; k < r; k++) pa += col.PA[k];
      pairs.push({ b, p, s, e: r, pa });
      for (const id of [b, p]) {
        const P = PLAYERS[id];
        P.first = Math.min(P.first, col.year[s]); P.last = Math.max(P.last, col.year[r - 1]);
      }
      s = r;
    }
  }
  TOP_PAIRS = pairs.sort((a, b) => b.pa - a.pa).slice(0, 30);
}

/* ---------------- stats for a block of rows ---------------- */
function sumRows(ranges) {
  const t = Object.fromEntries(COLS.map(c => [c, 0]));
  t.rows = 0;
  for (const [s, e] of ranges) for (let k = s; k < e; k++) { for (const c of COLS) t[c] += col[c][k]; t.rows++; }
  return t;
}
function rateOf(t, key) {
  const div = (a, b) => (b ? a / b : null);
  const obp = div(t.H + t.BB + t.HBP, t.AB + t.BB + t.HBP + t.SF);
  const slg = div(t.H + t["2B"] + 2 * t["3B"] + 3 * t.HR, t.AB);
  switch (key) {
    case "AVG": return div(t.H, t.AB);
    case "OBP": return obp;
    case "SLG": return slg;
    case "OPS": return obp == null || slg == null ? null : obp + slg;
    case "K_PCT": return div(t.SO, t.PA);
    case "BB_PCT": return div(t.BB, t.PA);
    default: return t[key];
  }
}
const KINDS = { AVG: "avg", OBP: "avg", SLG: "avg", OPS: "avg", K_PCT: "pct", BB_PCT: "pct" };
const MEASURES = {
  OPS: "OPS", AVG: "Batting average (AVG)", OBP: "On-base percentage (OBP)", SLG: "Slugging percentage (SLG)",
  HR: "Home runs (HR)", H: "Hits (H)", BB: "Walks (BB)", SO: "Strikeouts (SO)", PA: "Plate appearances (PA)",
  K_PCT: "Strikeout rate (SO / PA)", BB_PCT: "Walk rate (BB / PA)",
};
const kindOf = k => KINDS[k] || "int";
const nameOf = id => PLAYERS[id].name;

/* ---------------- setup ---------------- */
function init() {
  $("measure").innerHTML = Object.entries(MEASURES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("measure").value = state.measure;
  buildTopPairs();
  refreshPlayerList();
  wire();
  applyUrl();
  render();
}

function refreshPlayerList() {
  const map = state.mode === "hitter" ? byB : byP;
  const ids = [...map.keys()];
  const labels = new Map();
  const items = ids.map(id => {
    const P = PLAYERS[id];
    const total = map.get(id).reduce((a, x) => { for (let k = x.s; k < x.e; k++) a += col.PA[k]; return a; }, 0);
    return { id, label: `${P.name} (${P.first}–${P.last})`, total };
  }).sort((a, b) => a.label.localeCompare(b.label));
  const seen = new Set();
  items.forEach(it => { if (seen.has(it.label)) it.label += ` [${PLAYERS[it.id].retro}]`; seen.add(it.label); labels.set(it.label, it.id); });
  $("playerNames").innerHTML = items.map(it => `<option value="${it.label}">`).join("");
  window._mLabels = labels;
  window._mLabelOf = new Map(items.map(it => [it.id, it.label]));
}

function buildTopPairs() {
  $("topPairs").innerHTML = TOP_PAIRS.map((p, i) =>
    `<li><button class="linkish" data-i="${i}">${nameOf(p.b)} vs. ${nameOf(p.p)}</button> <span class="count">${p.pa} PA</span></li>`).join("");
}

function wire() {
  document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => {
    state.mode = b.dataset.v; state.primary = null; state.opp = null;
    refreshPlayerList(); $("playerSearch").value = ""; render();
  }));
  $("playerSearch").addEventListener("input", e => {
    const id = window._mLabels?.get(e.target.value);
    if (id != null) { state.primary = id; state.opp = null; render(); }
  });
  $("oppSearch").addEventListener("input", e => {
    const id = window._oppLabels?.get(e.target.value);
    if (id != null) { state.opp = id; render(); }
  });
  $("measure").addEventListener("change", e => { state.measure = e.target.value; render(); });
  $("minPA").addEventListener("input", e => ($("minPALabel").textContent = e.target.value));
  $("minPA").addEventListener("change", e => { state.minPA = +e.target.value; render(); });
  $("reset").addEventListener("click", () => {
    Object.assign(state, { primary: null, opp: null, measure: "OPS", minPA: 20, sort: { key: "PA", dir: -1 } });
    $("measure").value = "OPS"; $("minPA").value = 20; $("minPALabel").textContent = 20;
    $("playerSearch").value = ""; $("oppSearch").value = ""; render();
  });
  $("topPairs").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const p = TOP_PAIRS[+b.dataset.i];
    state.mode = "hitter"; refreshPlayerList();
    state.primary = p.b; state.opp = p.p; render();
  });
  $("exportCsv").addEventListener("click", exportSeasons);
  $("oppTable").addEventListener("click", e => {
    const th = e.target.closest("th[data-k]");
    if (th) { const k = th.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "name" ? 1 : -1) }; render(); return; }
    const tr = e.target.closest("tr[data-o]");
    if (tr) { state.opp = +tr.dataset.o; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
}

function applyUrl() {
  const p = new URLSearchParams(location.search);
  const find = r => PLAYERS.findIndex(x => x && x.retro === r);
  if (p.get("mode") === "pitcher") { state.mode = "pitcher"; refreshPlayerList(); }
  const a = p.get("b") && find(p.get("b")), c = p.get("p") && find(p.get("p"));
  if (a >= 0 && c >= 0 && p.get("b") && p.get("p")) { state.mode = "hitter"; refreshPlayerList(); state.primary = a; state.opp = c; }
}

/* ---------------- render ---------------- */
function render() {
  document.querySelectorAll("#modeSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === state.mode));
  const hitter = state.mode === "hitter";
  $("playerLabel").textContent = hitter ? "Pick a hitter" : "Pick a pitcher";
  $("playerSearch").placeholder = hitter ? "Type a hitter's name…" : "Type a pitcher's name…";
  $("oppLabel").textContent = hitter ? "Then a pitcher" : "Then a hitter";
  $("oppSearch").placeholder = hitter ? "Type a pitcher's name…" : "Type a hitter's name…";
  if (state.primary != null && $("playerSearch").value === "") $("playerSearch").value = window._mLabelOf.get(state.primary) || "";
  drawOpponents();
  drawDetail();
}

function pairBlocks() {
  const map = state.mode === "hitter" ? byB : byP;
  return (map.get(state.primary) || []);
}

function drawOpponents() {
  const card = $("oppCard");
  if (state.primary == null) {
    card.hidden = true; $("prompt").hidden = false; return;
  }
  card.hidden = false; $("prompt").hidden = true;
  const hitter = state.mode === "hitter";
  const P = PLAYERS[state.primary];
  oppRows = pairBlocks().map(x => {
    const t = sumRows([[x.s, x.e]]);
    return { o: x.o, name: nameOf(x.o), yrs: `${col.year[x.s]}–${col.year[x.e - 1]}`, t,
      PA: t.PA, AB: t.AB, H: t.H, HR: t.HR, BB: t.BB, SO: t.SO, AVG: rateOf(t, "AVG"), OBP: rateOf(t, "OBP"), SLG: rateOf(t, "SLG"), OPS: rateOf(t, "OPS") };
  }).filter(r => r.PA >= state.minPA);
  const { key, dir } = state.sort;
  oppRows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) * dir : ((a[key] ?? -1) - (b[key] ?? -1)) * dir));

  $("oppTitle").textContent = hitter
    ? `${P.name} against ${oppRows.length} pitchers (${P.first}–${P.last})`
    : `${P.name} against ${oppRows.length} hitters (${P.first}–${P.last})`;
  $("oppNote").textContent = `Career totals over the seasons in this data, for opponents faced at least ${state.minPA} times. Click a row to see the season-by-season line.`;

  const cols = [["name", hitter ? "Pitcher" : "Hitter"], ["yrs", "Seasons"], ["PA", "PA"], ["AB", "AB"], ["H", "H"], ["HR", "HR"], ["BB", "BB"], ["SO", "SO"], ["AVG", "AVG"], ["OBP", "OBP"], ["SLG", "SLG"], ["OPS", "OPS"]];
  const kinds = { PA: "int", AB: "int", H: "int", HR: "int", BB: "int", SO: "int", AVG: "avg", OBP: "avg", SLG: "avg", OPS: "avg" };
  $("oppTable").innerHTML = `
    <thead><tr>${cols.map(([k, h]) => `<th data-k="${k}" tabindex="0" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${oppRows.map(r => `<tr data-o="${r.o}" class="${r.o === state.opp ? "selected" : ""}" tabindex="0">${cols.map(([k]) => `<td>${kinds[k] ? fmt(r[k], kinds[k]) : r[k]}</td>`).join("")}</tr>`).join("")}</tbody>`;

  // opponent search list
  window._oppLabels = new Map(oppRows.map(r => [`${r.name} (${r.yrs})`, r.o]));
  $("oppNames").innerHTML = [...window._oppLabels.keys()].map(l => `<option value="${l}">`).join("");

  drawOppChart();
}

function drawOppChart() {
  const top = [...oppRows].sort((a, b) => b.PA - a.PA).slice(0, 10);
  const m = state.measure === "PA" ? "OPS" : state.measure;
  $("t-opp").textContent = `${MEASURES[m]} against the ${top.length} most-faced opponents`;
  oppChart?.destroy();
  oppChart = new Chart($("c-opp"), {
    type: "bar",
    data: { labels: top.map(r => r.name), datasets: [{ label: MEASURES[m], data: top.map(r => rateOf(r.t, m)), backgroundColor: top.map(r => (r.o === state.opp ? COLORS[1] : COLORS[0])) }] },
    options: { indexAxis: "y", interaction: { mode: "nearest", intersect: true },
      onClick: (e, els) => { if (els.length) { const o = top[els[0].index].o; setTimeout(() => { state.opp = o; render(); }, 0); } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.x, kindOf(m)) } } },
      scales: { x: { ticks: { callback: v => fmt(v, kindOf(m)) } }, y: { ticks: { autoSkip: false, font: { size: 11 } } } } },
  });
}

function drawDetail() {
  const card = $("detail");
  if (state.primary == null || state.opp == null || !oppRows.some(r => r.o === state.opp)) {
    card.hidden = true; return;
  }
  card.hidden = false;
  const hitter = state.mode === "hitter";
  const blk = pairBlocks().find(x => x.o === state.opp);
  const bName = hitter ? nameOf(state.primary) : nameOf(state.opp);
  const pName = hitter ? nameOf(state.opp) : nameOf(state.primary);
  $("detailTitle").textContent = `${bName} vs. ${pName}`;
  $("oppSearch").value = window._oppLabels ? [...window._oppLabels.entries()].find(([, v]) => v === state.opp)?.[0] || "" : "";

  seasonRows = [];
  for (let k = blk.s; k < blk.e; k++) {
    const t = Object.fromEntries(COLS.map(c => [c, col[c][k]])); t.rows = 1;
    seasonRows.push({ year: col.year[k], t });
  }
  const total = sumRows([[blk.s, blk.e]]);

  $("detailKpis").innerHTML = [
    ["Plate appearances", fmt(total.PA, "int")], ["AVG", fmt(rateOf(total, "AVG"), "avg")], ["OBP", fmt(rateOf(total, "OBP"), "avg")],
    ["SLG", fmt(rateOf(total, "SLG"), "avg")], ["OPS", fmt(rateOf(total, "OPS"), "avg")], ["Home runs", fmt(total.HR, "int")],
    ["Strikeouts", fmt(total.SO, "int")], ["Walks", fmt(total.BB, "int")],
  ].map(([l, v]) => `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${l}</div></div>`).join("");

  // season table
  const cols = [["year", "Season", null], ["PA", "PA", "int"], ["AB", "AB", "int"], ["H", "H", "int"], ["2B", "2B", "int"], ["3B", "3B", "int"], ["HR", "HR", "int"], ["BB", "BB", "int"], ["SO", "SO", "int"],
    ["AVG", "AVG", "avg"], ["OBP", "OBP", "avg"], ["SLG", "SLG", "avg"], ["OPS", "OPS", "avg"]];
  const cell = (r, [k, , kind]) => (kind ? fmt(k in r.t ? r.t[k] : rateOf(r.t, k), kind) : r.year);
  const totalRow = { year: "Career", t: total };
  $("seasonTable").innerHTML = `
    <thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join("")}</tr></thead>
    <tbody>${seasonRows.map(r => `<tr>${cols.map(c => `<td>${cell(r, c)}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${cols.map(c => `<td>${cell(totalRow, c)}</td>`).join("")}</tr></tfoot>`;
  $("t-seasons").textContent = `${bName} vs. ${pName}: season by season`;

  // chart: PA as bars, chosen measure as a line
  const m = state.measure, kind = kindOf(m), years = seasonRows.map(r => r.year);
  $("t-detailChart").textContent = `${MEASURES[m]} by season`;
  chart?.destroy();
  const line = { type: m === "PA" ? "bar" : "line", label: MEASURES[m], data: seasonRows.map(r => rateOf(r.t, m)), borderColor: COLORS[1], backgroundColor: m === "PA" ? COLORS[1] : "rgba(200,16,46,.12)", pointRadius: 4, yAxisID: "y", order: 1, spanGaps: true };
  const datasets = m === "PA" ? [line]
    : [line, { type: "bar", label: "Plate appearances", data: seasonRows.map(r => r.t.PA), backgroundColor: "rgba(22,57,42,.25)", yAxisID: "y1", order: 2 }];
  chart = new Chart($("c-detail"), {
    type: "bar", data: { labels: years, datasets },
    options: {
      plugins: { legend: { display: m !== "PA" }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, c.dataset.yAxisID === "y1" ? "int" : kind)}` } } },
      scales: { y: { ticks: { callback: v => fmt(v, kind) }, title: { display: true, text: MEASURES[m] } },
        y1: { display: m !== "PA", position: "right", grid: { drawOnChartArea: false }, title: { display: true, text: "Plate appearances" }, beginAtZero: true } },
    },
  });
}

function exportSeasons() {
  if (!seasonRows.length) return;
  const rows = [["Season", ...COLS, "AVG", "OBP", "SLG", "OPS"],
    ...seasonRows.map(r => [r.year, ...COLS.map(c => r.t[c]), ...["AVG", "OBP", "SLG", "OPS"].map(k => rateOf(r.t, k))])];
  downloadCSV(rows, `matchup-${PLAYERS[state.primary].retro}-${PLAYERS[state.opp].retro}`);
}
})();
