/* ------------------------------------------------------------------
   dashboard.js: loads data/batting.csv and recalculates everything
   in the browser whenever a filter or switch changes.
------------------------------------------------------------------- */
applyChartTheme();

const BREAKDOWNS = { pos: "Primary position", franchise: "Franchise", league: "League", bats: "Batting hand", decade: "Decade" };
const LEADER_MIN_PA = 1000;   // rate leaderboards only include players with this many PA in the current view
const HIST_MIN_PA = 100;      // rate histograms only include player-seasons with this many PA

let DATA = [];
let DOMAIN = {};
let PLAYERS = new Map(); // playerID -> array of that player's season rows
const state = {};
const charts = {};
let tableRows = [], tableSort = { key: "PA", dir: -1 };

/* ---------------- load ---------------- */
Papa.parse("data/batting.csv?v=" + DATA_VERSION, {
  download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
  complete: res => {
    DATA = res.data.map(r => { SUM_COLS.forEach(c => (r[c] = +r[c] || 0)); r.year = +r.year; return r; });
    init();
    document.getElementById("loading").hidden = true;
  },
  error: err => {
    document.getElementById("loading").textContent = "Could not load data/batting.csv. Run scripts/prep_data.py and serve the site through a web server.";
    console.error(err);
  },
});

/* ---------------- setup ---------------- */
function uniq(key) { return [...new Set(DATA.map(r => r[key]))].sort(); }

function init() {
  const ys = DATA.map(r => r.year);
  DOMAIN = {
    yearMin: Math.min(...ys), yearMax: Math.max(...ys),
    franchise: uniq("franchise"), league: uniq("league"), pos: uniq("pos"), bats: uniq("bats"),
  };

  // measure select
  const ms = document.getElementById("measure");
  ms.innerHTML = Object.entries(MEASURES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("");

  // season inputs
  ["yearMin", "yearMax", "yearMinSlider", "yearMaxSlider"].forEach(id => {
    const el = document.getElementById(id); el.min = DOMAIN.yearMin; el.max = DOMAIN.yearMax;
  });

  buildChips("leagueChips", "league");
  buildChips("posChips", "pos");
  buildChips("batsChips", "bats");
  buildFranchiseList();
  buildPlayerIndex();
  wire();
  resetState();
  applyUrlParams();
}

/* ---------------- URL deep links (from report findings) ---------------- */
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return;
  if (p.has("measure") && MEASURES[p.get("measure")]) state.measure = p.get("measure");
  if (p.has("breakdown") && BREAKDOWNS[p.get("breakdown")]) state.breakdown = p.get("breakdown");
  if (p.has("trend")) state.trendMode = p.get("trend") === "split" ? "split" : "all";
  if (p.has("yearMin")) state.yearMin = Math.max(DOMAIN.yearMin, Math.min(DOMAIN.yearMax, +p.get("yearMin") || state.yearMin));
  if (p.has("yearMax")) state.yearMax = Math.max(DOMAIN.yearMin, Math.min(DOMAIN.yearMax, +p.get("yearMax") || state.yearMax));
  if (p.has("franchise") && DOMAIN.franchise.includes(p.get("franchise"))) state.franchise = new Set([p.get("franchise")]);
  if (p.has("league") && DOMAIN.league.includes(p.get("league"))) state.league = new Set([p.get("league")]);
  if (p.has("pos") && DOMAIN.pos.includes(p.get("pos"))) state.pos = new Set([p.get("pos")]);
  if (p.has("bats") && DOMAIN.bats.includes(p.get("bats"))) state.bats = new Set([p.get("bats")]);
  syncInputs();
  update();
}

/* ---------------- clicking a chart segment narrows the filters ---------------- */
function drillDown(breakdown, label) {
  if (breakdown === "decade") {
    const y = parseInt(label, 10);
    if (Number.isNaN(y)) return;
    state.yearMin = Math.max(DOMAIN.yearMin, y);
    state.yearMax = Math.min(DOMAIN.yearMax, y + 9);
  } else if (DOMAIN[breakdown]) {
    state[breakdown] = new Set([label]);
  }
  syncInputs();
  update();
  document.querySelector(".controls")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------------- player lookup ---------------- */
function buildPlayerIndex() {
  PLAYERS = new Map();
  DATA.forEach(r => {
    if (!PLAYERS.has(r.playerID)) PLAYERS.set(r.playerID, []);
    PLAYERS.get(r.playerID).push(r);
  });
  const options = [...PLAYERS.entries()].map(([id, rows]) => {
    const years = rows.map(r => r.year);
    return { id, label: `${rows[0].name} (${Math.min(...years)}–${Math.max(...years)})` };
  }).sort((a, b) => a.label.localeCompare(b.label));
  document.getElementById("playerNames").innerHTML = options.map(o => `<option value="${o.label}">`).join("");
  window._playerLabelToId = new Map(options.map(o => [o.label, o.id]));
}

function showPlayer(id) {
  const rows = PLAYERS.get(id);
  if (!rows) return;
  const seasons = [...rows].sort((a, b) => a.year - b.year);
  const t = totalsOf(seasons);
  const years = seasons.map(r => r.year);
  const posCounts = groupBy(seasons, r => r.pos);
  const primaryPos = [...posCounts.entries()].sort((a, b) => b[1].rows - a[1].rows)[0][0];

  document.getElementById("playerResult").hidden = false;
  document.getElementById("playerResult").innerHTML = `
    <div class="player-result-head">
      <h3>${seasons[0].name}</h3>
      <span>${Math.min(...years)}–${Math.max(...years)} · ${primaryPos} · Bats ${seasons[0].bats}</span>
    </div>
    <div class="player-tiles">
      <div class="tile"><div class="tile-value">${fmt(t.rows, "int")}</div><div class="tile-label">Seasons</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.PA, "int")}</div><div class="tile-label">Plate app.</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.HR, "int")}</div><div class="tile-label">Home runs</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.R, "int")}</div><div class="tile-label">Runs</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.RBI, "int")}</div><div class="tile-label">RBI</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.SB, "int")}</div><div class="tile-label">Stolen bases</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "BA"), "avg")}</div><div class="tile-label">AVG</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "OBP"), "avg")}</div><div class="tile-label">OBP</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "SLG"), "avg")}</div><div class="tile-label">SLG</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "OPS"), "avg")}</div><div class="tile-label">OPS</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "K_PCT"), "pct")}</div><div class="tile-label">K%</div></div>
    </div>
    <div class="player-chart-head">
      <label for="playerMeasure">Season by season</label>
      <select id="playerMeasure">${Object.entries(MEASURES).map(([k, m]) => `<option value="${k}" ${k === "OPS" ? "selected" : ""}>${m.label}</option>`).join("")}</select>
    </div>
    <div class="chart-box" style="height:220px"><canvas id="c-player" role="img" aria-label="Player season by season"></canvas></div>`;

  const draw = measure => {
    const kind = MEASURES[measure].kind;
    make("player", {
      type: "line",
      data: { labels: years, datasets: [{ label: MEASURES[measure].label, data: seasons.map(r => { const rt = emptyTotals(); addRow(rt, r); return val(rt, measure); }),
        borderColor: COLORS[1], backgroundColor: "rgba(200,16,46,.1)", fill: true }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.y, kind) } } },
        scales: { y: axisFor(kind), x: { ticks: { maxTicksLimit: 12 } } } },
    });
  };
  draw("OPS");
  document.getElementById("playerMeasure").addEventListener("change", e => draw(e.target.value));
  document.getElementById("playerCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetState() {
  Object.assign(state, {
    yearMin: DOMAIN.yearMin, yearMax: DOMAIN.yearMax,
    franchise: new Set(DOMAIN.franchise), league: new Set(DOMAIN.league),
    pos: new Set(DOMAIN.pos), bats: new Set(DOMAIN.bats), minPA: 0,
    measure: "HR_PCT", breakdown: "pos", trendMode: "all",
  });
  syncInputs();
  update();
}

function syncInputs() {
  const set = (id, v) => (document.getElementById(id).value = v);
  set("yearMin", state.yearMin); set("yearMax", state.yearMax);
  set("yearMinSlider", state.yearMin); set("yearMaxSlider", state.yearMax);
  set("minPA", state.minPA); set("measure", state.measure); set("breakdown", state.breakdown);
  document.getElementById("minPALabel").textContent = state.minPA;
  document.getElementById("franchiseSearch").value = "";
  filterFranchiseList("");
  ["league", "pos", "bats"].forEach(k =>
    document.querySelectorAll(`[data-key="${k}"]`).forEach(b => b.setAttribute("aria-pressed", state[k].has(b.dataset.val))));
  document.querySelectorAll("#franchiseList input").forEach(cb => (cb.checked = state.franchise.has(cb.value)));
  document.querySelectorAll("#trendMode button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === state.trendMode));
}

function buildChips(containerId, key) {
  document.getElementById(containerId).innerHTML = DOMAIN[key]
    .map(v => `<button class="chip" data-key="${key}" data-val="${v}" aria-pressed="true">${v}</button>`).join("");
}

function buildFranchiseList() {
  document.getElementById("franchiseList").innerHTML = DOMAIN.franchise
    .map(f => `<label><input type="checkbox" value="${f}" checked> ${f}</label>`).join("");
}
function filterFranchiseList(q) {
  q = q.toLowerCase();
  document.querySelectorAll("#franchiseList label").forEach(l => (l.style.display = l.textContent.toLowerCase().includes(q) ? "" : "none"));
}

function wire() {
  const clampYears = (changed) => {
    if (state.yearMin > state.yearMax) changed === "min" ? (state.yearMax = state.yearMin) : (state.yearMin = state.yearMax);
    syncInputs(); update();
  };
  const bound = v => Math.max(DOMAIN.yearMin, Math.min(DOMAIN.yearMax, +v || DOMAIN.yearMin));
  ["yearMin", "yearMinSlider"].forEach(id => document.getElementById(id).addEventListener("change", e => { state.yearMin = bound(e.target.value); clampYears("min"); }));
  ["yearMax", "yearMaxSlider"].forEach(id => document.getElementById(id).addEventListener("change", e => { state.yearMax = bound(e.target.value); clampYears("max"); }));
  document.getElementById("yearMinSlider").addEventListener("input", e => (document.getElementById("yearMin").value = e.target.value));
  document.getElementById("yearMaxSlider").addEventListener("input", e => (document.getElementById("yearMax").value = e.target.value));

  document.querySelector(".filters").addEventListener("click", e => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    const s = state[chip.dataset.key], v = chip.dataset.val;
    s.has(v) ? s.delete(v) : s.add(v);
    chip.setAttribute("aria-pressed", s.has(v));
    update();
  });

  document.getElementById("franchiseList").addEventListener("change", e => {
    e.target.checked ? state.franchise.add(e.target.value) : state.franchise.delete(e.target.value);
    update();
  });
  document.getElementById("franchiseSearch").addEventListener("input", e => filterFranchiseList(e.target.value));
  document.getElementById("franchAll").addEventListener("click", () => { state.franchise = new Set(DOMAIN.franchise); syncInputs(); update(); });
  document.getElementById("franchNone").addEventListener("click", () => { state.franchise = new Set(); syncInputs(); update(); });

  const minPA = document.getElementById("minPA");
  minPA.addEventListener("input", e => (document.getElementById("minPALabel").textContent = e.target.value));
  minPA.addEventListener("change", e => { state.minPA = +e.target.value; update(); });

  document.getElementById("measure").addEventListener("change", e => { state.measure = e.target.value; update(); });
  document.getElementById("breakdown").addEventListener("change", e => { state.breakdown = e.target.value; tableSort = { key: "PA", dir: -1 }; update(); });
  document.getElementById("trendMode").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.trendMode = b.dataset.v; syncInputs(); update();
  });
  document.getElementById("reset").addEventListener("click", resetState);

  document.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", () => {
    const c = charts[b.dataset.save]; if (c) downloadChart(c, `mlb-${b.dataset.save}-${state.measure}`);
  }));
  document.getElementById("exportCsv").addEventListener("click", exportTable);

  document.getElementById("playerSearch").addEventListener("input", e => {
    const id = window._playerLabelToId?.get(e.target.value);
    if (id) showPlayer(id);
  });
}

/* ---------------- filtering + aggregation ---------------- */
function filtered() {
  const s = state;
  return DATA.filter(r =>
    r.year >= s.yearMin && r.year <= s.yearMax && r.PA >= s.minPA &&
    s.franchise.has(r.franchise) && s.league.has(r.league) && s.pos.has(r.pos) && s.bats.has(r.bats));
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, emptyTotals());
    addRow(m.get(k), r);
  }
  return m;
}
function totalsOf(rows) { const t = emptyTotals(); rows.forEach(r => addRow(t, r)); return t; }
const M = () => MEASURES[state.measure];
const val = (t, key = state.measure) => MEASURES[key].fn(t);

/* ---------------- update everything ---------------- */
function update() {
  const rows = filtered();
  const all = totalsOf(rows);
  document.getElementById("status").textContent = `Showing ${fmt(rows.length, "int")} of ${fmt(DATA.length, "int")} player-seasons`;
  document.getElementById("yearLabel").textContent = `${state.yearMin}–${state.yearMax}`;
  document.getElementById("franchiseCount").textContent = `${state.franchise.size} of ${DOMAIN.franchise.length}`;

  drawKpis(all);
  if (!rows.length) { showEmpty(); return; }
  const groups = groupBy(rows, r => r[state.breakdown]);
  drawTrend(rows, groups);
  drawBar(groups);
  drawScatter(groups);
  drawLeaders(rows);
  drawHist(rows);
  drawHeatmap(rows);
  drawTable(groups, all);
}

function showEmpty() {
  Object.values(charts).forEach(c => c.destroy());
  Object.keys(charts).forEach(k => delete charts[k]);
  document.getElementById("heatmap").innerHTML = `<p class="empty">No player-seasons match these filters. Widen a filter or press Reset all filters.</p>`;
  document.getElementById("table").innerHTML = "";
}

/* ---------------- summary numbers ---------------- */
function drawKpis(t) {
  const tiles = [
    ["Player-seasons", fmt(t.rows, "int")],
    ["Plate appearances", compact(t.PA)],
    ["Home runs (HR)", fmt(t.HR, "int")],
    ["Runs (R)", fmt(t.R, "int")],
    ["RBI", fmt(t.RBI, "int")],
    ["Batting average (AVG)", fmt(val(t, "BA"), "avg")],
    ["Stolen bases (SB)", fmt(t.SB, "int")],
    ["OPS", fmt(val(t, "OPS"), "avg")],
    ["Strikeout rate", fmt(val(t, "K_PCT"), "pct")],
    [M().label, fmt(val(t), M().kind)],
  ];
  document.getElementById("kpis").innerHTML = tiles.map(([l, v]) =>
    `<div class="tile"><div class="tile-value">${t.rows ? v : "–"}</div><div class="tile-label">${l}</div></div>`).join("");
}

/* ---------------- charts ---------------- */
function axisFor(kind) {
  if (kind === "pct") return { ticks: { callback: v => (v * 100).toFixed(1) + "%" } };
  if (kind === "avg") return { ticks: { callback: v => fmt(v, "avg") } };
  return { ticks: { callback: v => compact(v) } };
}
function make(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById("c-" + id), config);
}
const topKeys = (groups, n) => [...groups.entries()].sort((a, b) => b[1].PA - a[1].PA).slice(0, n).map(([k]) => k);

function drawTrend(rows, groups) {
  const m = M(), years = [];
  for (let y = state.yearMin; y <= state.yearMax; y++) years.push(y);
  let datasets;
  if (state.trendMode === "split") {
    const keys = topKeys(groups, 8);
    const byKY = groupBy(rows.filter(r => keys.includes(r[state.breakdown])), r => r[state.breakdown] + "|" + r.year);
    datasets = keys.map((k, i) => ({
      label: k, borderColor: COLORS[i % COLORS.length], backgroundColor: COLORS[i % COLORS.length],
      data: years.map(y => (byKY.has(k + "|" + y) ? val(byKY.get(k + "|" + y)) : null)), spanGaps: true,
    }));
  } else {
    const byY = groupBy(rows, r => r.year);
    datasets = [{ label: "All selected", borderColor: COLORS[0], backgroundColor: "rgba(22,57,42,.08)", fill: true,
      data: years.map(y => (byY.has(y) ? val(byY.get(y)) : null)) }];
  }
  const split = state.trendMode === "split" ? ` (largest ${Math.min(8, groups.size)} groups by ${BREAKDOWNS[state.breakdown].toLowerCase()})` : "";
  document.getElementById("t-trend").textContent = `${m.label} by season${split}`;
  make("trend", {
    type: "line", data: { labels: years, datasets },
    options: {
      plugins: { legend: { display: datasets.length > 1 }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y, m.kind)}` } } },
      scales: { y: axisFor(m.kind), x: { ticks: { maxTicksLimit: 14 } } },
    },
  });
}

function drawBar(groups) {
  const m = M();
  const entries = [...groups.entries()].map(([k, t]) => [k, val(t)]).filter(e => e[1] != null)
    .sort((a, b) => (state.breakdown === "decade" ? a[0].localeCompare(b[0]) : b[1] - a[1]));
  const horizontal = entries.length > 8;
  document.getElementById("t-bar").textContent = `${m.label} by ${BREAKDOWNS[state.breakdown].toLowerCase()}`;
  document.getElementById("c-bar").parentElement.style.height = horizontal ? Math.max(320, entries.length * 22) + "px" : "";
  make("bar", {
    type: "bar",
    data: { labels: entries.map(e => e[0]), datasets: [{ label: m.label, data: entries.map(e => e[1]),
      backgroundColor: entries.map((_, i) => (i === 0 && state.breakdown !== "decade" ? COLORS[1] : COLORS[0])) }] },
    options: {
      indexAxis: horizontal ? "y" : "x", interaction: { mode: "nearest", intersect: true },
      onClick: (evt, els) => { if (els.length) { const lab = entries[els[0].index][0]; setTimeout(() => drillDown(state.breakdown, lab), 0); } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(horizontal ? c.parsed.x : c.parsed.y, m.kind) } } },
      scales: { [horizontal ? "x" : "y"]: axisFor(m.kind), [horizontal ? "y" : "x"]: { ticks: { autoSkip: false, font: { size: 11 } } } },
    },
  });
}

function drawScatter(groups) {
  const entries = [...groups.entries()];
  const maxPA = Math.max(...entries.map(([, t]) => t.PA));
  document.getElementById("t-scatter").textContent = `Strikeout rate vs. home run rate by ${BREAKDOWNS[state.breakdown].toLowerCase()}`;
  make("scatter", {
    type: "bubble",
    data: { datasets: entries.map(([k, t], i) => ({
      label: k, backgroundColor: COLORS[i % COLORS.length] + "b3", borderColor: COLORS[i % COLORS.length],
      data: [{ x: val(t, "K_PCT"), y: val(t, "HR_PCT"), r: 4 + 18 * Math.sqrt(t.PA / maxPA) }],
    })) },
    options: {
      interaction: { mode: "nearest", intersect: true },
      onClick: (evt, els) => { if (els.length) { const lab = entries[els[0].datasetIndex][0]; setTimeout(() => drillDown(state.breakdown, lab), 0); } },
      plugins: { legend: { display: entries.length <= 10 },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: K ${fmt(c.parsed.x, "pct")}, HR ${fmt(c.parsed.y, "pct")}` } } },
      scales: { x: { title: { display: true, text: "Strikeout rate" }, ...axisFor("pct") }, y: { title: { display: true, text: "Home run rate" }, ...axisFor("pct") } },
    },
  });
}

function drawLeaders(rows) {
  const m = M();
  const players = groupBy(rows, r => r.playerID);
  const names = new Map(rows.map(r => [r.playerID, r.name]));
  let list = [...players.entries()];
  if (m.rate) list = list.filter(([, t]) => t.PA >= LEADER_MIN_PA);
  list = list.map(([id, t]) => [id, names.get(id), val(t)]).filter(e => e[2] != null).sort((a, b) => b[2] - a[2]).slice(0, 10);
  document.getElementById("t-leaders").textContent = `Top 10 players: ${m.label}`;
  document.getElementById("n-leaders").textContent = (m.rate
    ? `Players with at least ${fmt(LEADER_MIN_PA, "int")} plate appearances in the current view. Totals are summed across the filtered seasons.`
    : "Totals are summed across the filtered seasons and teams.") + " Click a bar to look up that player.";
  make("leaders", {
    type: "bar",
    data: { labels: list.map(e => e[1]), datasets: [{ label: m.label, data: list.map(e => e[2]), backgroundColor: list.map((_, i) => (i ? COLORS[2] : COLORS[1])) }] },
    options: {
      indexAxis: "y", interaction: { mode: "nearest", intersect: true },
      onClick: (evt, els) => { if (els.length) { const id = list[els[0].index][0]; setTimeout(() => showPlayer(id), 0); } },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.x, m.kind) } } },
      scales: { x: axisFor(m.kind), y: { ticks: { autoSkip: false, font: { size: 11 } } } },
    },
  });
}

function drawHist(rows) {
  const m = M();
  // Which per-row value to plot for each measure
  const rowKey = { rows: "PA", medPA: "PA", medHR: "HR", PA: "PA", G: "G", HR: "HR", H: "H", R: "R", RBI: "RBI", SB: "SB", BB: "BB", SO: "SO", "2B": "2B", "3B": "3B", TB: "TB", XBH: "XBH" }[state.measure];
  const rowVal = (r, k) => (k === "TB" ? r.H + r["2B"] + 2 * r["3B"] + 3 * r.HR : k === "XBH" ? r["2B"] + r["3B"] + r.HR : r[k]);
  let values, kind = m.kind, label;
  if (m.rate) {
    values = rows.filter(r => r.PA >= HIST_MIN_PA).map(r => { const t = emptyTotals(); addRow(t, r); return val(t); }).filter(v => v != null);
    label = m.label;
    document.getElementById("n-hist").textContent = `Player-seasons with at least ${HIST_MIN_PA} plate appearances (${fmt(values.length, "int")} shown).`;
  } else {
    values = rows.map(r => rowVal(r, rowKey)); kind = "int";
    label = { PA: "Plate appearances", HR: "Home runs", H: "Hits", G: "Games", R: "Runs", RBI: "RBI", SB: "Stolen bases", BB: "Walks", SO: "Strikeouts", "2B": "Doubles", "3B": "Triples", TB: "Total bases", XBH: "Extra-base hits" }[rowKey] + " per player-season";
    document.getElementById("n-hist").textContent = `All ${fmt(values.length, "int")} player-seasons in the current view.`;
  }
  document.getElementById("t-hist").textContent = `Distribution: ${label}`;
  if (!values.length) { charts.hist?.destroy(); return; }
  // 20 equal-width bins from the 1st to 99th percentile so outliers don't flatten the chart
  const s = [...values].sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.01)], hi = s[Math.floor(s.length * 0.99)] || lo + 1;
  const n = 20, w = (hi - lo) / n || 1, bins = new Array(n).fill(0);
  values.forEach(v => { bins[Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)))]++; });
  const labels = bins.map((_, i) => fmt(lo + i * w, kind === "int" ? "dec1" : kind));
  make("hist", {
    type: "bar",
    data: { labels, datasets: [{ label: "Player-seasons", data: bins, backgroundColor: COLORS[4], barPercentage: 1, categoryPercentage: 0.95 }] },
    options: {
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => `${labels[c[0].dataIndex]} to ${fmt(lo + (c[0].dataIndex + 1) * w, kind === "int" ? "dec1" : kind)}`, label: c => `${fmt(c.parsed.y, "int")} player-seasons` } } },
      scales: { x: { ticks: { maxTicksLimit: 8 } }, y: { title: { display: true, text: "Player-seasons" } } },
    },
  });
}

/* Heatmap: breakdown values (rows) x decades (columns), colored by the measure */
function drawHeatmap(rows) {
  const m = M(), bk = state.breakdown === "decade" ? "league" : state.breakdown;
  const cells = groupBy(rows, r => r[bk] + "|" + r.decade);
  const decades = [...new Set(rows.map(r => r.decade))].sort();
  const keys = [...groupBy(rows, r => r[bk]).entries()].sort((a, b) => b[1].PA - a[1].PA).map(([k]) => k);
  const vals = [...cells.values()].map(t => val(t)).filter(v => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const color = v => {
    if (v == null) return "background:#eef0ec;color:#99a";
    const p = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    const l = 94 - p * 64;                              // light to dark green
    return `background:hsl(152,45%,${l}%);color:${l < 55 ? "#fff" : "#1a2230"}`;
  };
  document.getElementById("t-heat").textContent = `${m.label}: ${BREAKDOWNS[bk].toLowerCase()} by decade`;
  document.getElementById("heatmap").innerHTML = `
    <table class="heatmap">
      <thead><tr><th>${BREAKDOWNS[bk]}</th>${decades.map(d => `<th>${d}</th>`).join("")}</tr></thead>
      <tbody>${keys.map(k => `<tr><th>${k}</th>${decades.map(d => {
        const t = cells.get(k + "|" + d), v = t ? val(t) : null;
        return `<td style="${color(v)}" title="${k}, ${d}: ${fmt(v, m.kind)}">${fmt(v, m.kind === "int" ? "int" : m.kind)}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table>
    ${state.breakdown === "decade" ? '<p class="chart-note">Decade is already the column, so rows show league.</p>' : ""}`;
}

/* ---------------- table ---------------- */
const TABLE_COLS = [
  ["group", null], ["rows", "int"], ["PA", "int"], ["H", "int"], ["HR", "int"], ["R", "int"], ["RBI", "int"], ["SB", "int"],
  ["BA", "avg"], ["OBP", "avg"], ["SLG", "avg"], ["OPS", "avg"], ["K_PCT", "pct"], ["BB_PCT", "pct"], ["HR_PCT", "pct"],
];
const HEAD = { group: null, rows: "Player-seasons", PA: "PA", H: "Hits", HR: "HR", R: "R", RBI: "RBI", SB: "SB", BA: "AVG", OBP: "OBP", SLG: "SLG", OPS: "OPS", K_PCT: "K%", BB_PCT: "BB%", HR_PCT: "HR%" };

function drawTable(groups, all) {
  const extra = TABLE_COLS.some(([k]) => k === state.measure) ? [] : [[state.measure, M().kind]];
  const cols = [...TABLE_COLS, ...extra];
  const rowOf = (name, t) => Object.fromEntries(cols.map(([k]) => [k, k === "group" ? name : val(t, k)]));
  tableRows = [...groups.entries()].map(([k, t]) => rowOf(k, t));
  const { key, dir } = tableSort;
  tableRows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) * dir : ((a[key] ?? -1) - (b[key] ?? -1)) * dir));
  const totalRow = rowOf("All selected", all);
  const head = k => (k === "group" ? BREAKDOWNS[state.breakdown] : HEAD[k] || MEASURES[k].label);

  document.getElementById("t-table").textContent = `Numbers behind the current view, by ${BREAKDOWNS[state.breakdown].toLowerCase()}`;
  document.getElementById("table").innerHTML = `
    <thead><tr>${cols.map(([k]) => `<th data-k="${k}" tabindex="0" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${head(k)}</th>`).join("")}</tr></thead>
    <tbody>${tableRows.map(r => `<tr>${cols.map(([k, kind]) => `<td>${kind ? fmt(r[k], kind) : r[k]}</td>`).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${cols.map(([k, kind]) => `<td>${kind ? fmt(totalRow[k], kind) : totalRow[k]}</td>`).join("")}</tr></tfoot>`;
  document.querySelectorAll("#table th").forEach(th => {
    const sort = () => { const k = th.dataset.k; tableSort = { key: k, dir: tableSort.key === k ? -tableSort.dir : (k === "group" ? 1 : -1) }; update(); };
    th.addEventListener("click", sort);
    th.addEventListener("keydown", e => { if (e.key === "Enter") sort(); });
  });
  tableRows.cols = cols; tableRows.total = totalRow; tableRows.head = head;
}

function exportTable() {
  const { cols, total, head } = tableRows;
  if (!cols) return;
  const out = [cols.map(([k]) => head(k)), ...tableRows.map(r => cols.map(([k]) => r[k])), cols.map(([k]) => total[k])];
  downloadCSV(out, `mlb-${state.breakdown}-${state.yearMin}-${state.yearMax}`);
}
