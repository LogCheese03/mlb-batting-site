/* ------------------------------------------------------------------
   pitching.js: loads data/pitching.csv and recalculates everything
   in the browser whenever a filter or switch changes. It mirrors
   dashboard.js (the hitting dashboard) and the pitching formulas in
   scripts/prep_data.py. Wrapped in a function so its names cannot
   collide with the hitting model in common.js.
------------------------------------------------------------------- */
(function () {
applyChartTheme();

const BREAKDOWNS = { role: "Role (starter / reliever)", franchise: "Franchise", league: "League", throws: "Throwing hand", decade: "Decade" };
const LEADER_MIN_BFP = 1000;  // rate leaderboards only include pitchers with this many batters faced in the current view
const HIST_MIN_BFP = 100;     // rate histograms only include pitcher-seasons with this many batters faced

/* ---------------- model: totals, measures ---------------- */
const SUM_COLS = ["G", "GS", "CG", "SHO", "SV", "W", "L", "IPouts", "BFP", "H", "R", "ER", "HR", "BB", "SO", "HBP"];
function emptyTotals() {
  const t = { rows: 0, soList: [], ipList: [] };
  SUM_COLS.forEach(c => (t[c] = 0));
  return t;
}
function addRow(t, row) {
  t.rows += 1;
  for (const c of SUM_COLS) t[c] += row[c];
  t.soList.push(row.SO);
  t.ipList.push(row.IPouts / 3);
}
const ip = t => t.IPouts / 3;
const per9 = (num, t) => safeDiv(9 * num, ip(t));

/* lower: true means a smaller number is better (the leaderboard sorts ascending) */
const MEASURES = {
  rows:   { label: "Pitcher-seasons (count)", kind: "int", fn: t => t.rows },
  IP:     { label: "Innings pitched (total)", kind: "int", fn: t => ip(t) },
  G:      { label: "Games (total)", kind: "int", fn: t => t.G },
  GS:     { label: "Games started (total)", kind: "int", fn: t => t.GS },
  CG:     { label: "Complete games (total)", kind: "int", fn: t => t.CG },
  W:      { label: "Wins (total)", kind: "int", fn: t => t.W },
  L:      { label: "Losses (total)", kind: "int", fn: t => t.L },
  SV:     { label: "Saves (total)", kind: "int", fn: t => t.SV },
  SHO:    { label: "Shutouts (total)", kind: "int", fn: t => t.SHO },
  SO:     { label: "Strikeouts (K total)", kind: "int", fn: t => t.SO },
  BB:     { label: "Walks (total)", kind: "int", fn: t => t.BB },
  HR:     { label: "Home runs allowed (total)", kind: "int", fn: t => t.HR },
  H:      { label: "Hits allowed (total)", kind: "int", fn: t => t.H },
  ER:     { label: "Earned runs (total)", kind: "int", fn: t => t.ER },
  medSO:  { label: "Strikeouts per pitcher-season (median)", kind: "dec1", fn: t => median(t.soList) },
  medIP:  { label: "Innings per pitcher-season (median)", kind: "dec1", fn: t => median(t.ipList) },
  ERA:    { label: "ERA (9 × ER / IP)", kind: "dec2", rate: true, lower: true, fn: t => per9(t.ER, t) },
  WHIP:   { label: "WHIP ((BB + H) / IP)", kind: "dec2", rate: true, lower: true, fn: t => safeDiv(t.BB + t.H, ip(t)) },
  K9:     { label: "Strikeouts per 9 innings", kind: "dec2", rate: true, fn: t => per9(t.SO, t) },
  BB9:    { label: "Walks per 9 innings", kind: "dec2", rate: true, lower: true, fn: t => per9(t.BB, t) },
  HR9:    { label: "Home runs allowed per 9 innings", kind: "dec2", rate: true, lower: true, fn: t => per9(t.HR, t) },
  H9:     { label: "Hits allowed per 9 innings", kind: "dec2", rate: true, lower: true, fn: t => per9(t.H, t) },
  K_PCT:  { label: "Strikeout rate (SO / batters faced)", kind: "pct", rate: true, fn: t => safeDiv(t.SO, t.BFP) },
  BB_PCT: { label: "Walk rate (BB / batters faced)", kind: "pct", rate: true, lower: true, fn: t => safeDiv(t.BB, t.BFP) },
  HR_PCT: { label: "Home run rate (HR / batters faced)", kind: "pct", rate: true, lower: true, fn: t => safeDiv(t.HR, t.BFP) },
  K_BB:   { label: "Strikeout-to-walk ratio (SO / BB)", kind: "dec2", rate: true, fn: t => safeDiv(t.SO, t.BB) },
  KBB_PCT:{ label: "K–BB% ((SO − BB) / batters faced)", kind: "pct", rate: true, fn: t => safeDiv(t.SO - t.BB, t.BFP) },
  WIN_PCT:{ label: "Win percentage (W / (W + L))", kind: "pct", rate: true, fn: t => safeDiv(t.W, t.W + t.L) },
  IP_G:   { label: "Innings per appearance (IP / G)", kind: "dec2", rate: true, fn: t => safeDiv(ip(t), t.G) },
};

let DATA = [];
let DOMAIN = {};
let PLAYERS = new Map(); // playerID -> array of that pitcher's season rows
const state = {};
const charts = {};
let tableRows = [], tableSort = { key: "IP", dir: -1 };

/* ---------------- load ---------------- */
Papa.parse("data/pitching.csv?v=" + DATA_VERSION, {
  download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
  complete: res => {
    DATA = res.data.map(r => { SUM_COLS.forEach(c => (r[c] = +r[c] || 0)); r.year = +r.year; return r; });
    init();
    document.getElementById("loading").hidden = true;
  },
  error: err => {
    document.getElementById("loading").textContent = "Could not load data/pitching.csv. Run scripts/prep_data.py and serve the site through a web server.";
    console.error(err);
  },
});

/* ---------------- setup ---------------- */
function uniq(key) { return [...new Set(DATA.map(r => r[key]))].sort(); }

function init() {
  const ys = DATA.map(r => r.year);
  DOMAIN = {
    yearMin: Math.min(...ys), yearMax: Math.max(...ys),
    franchise: uniq("franchise"), league: uniq("league"), role: uniq("role"), throws: uniq("throws"),
  };

  const ms = document.getElementById("measure");
  ms.innerHTML = Object.entries(MEASURES).map(([k, m]) => `<option value="${k}">${m.label}</option>`).join("");

  ["yearMin", "yearMax", "yearMinSlider", "yearMaxSlider"].forEach(id => {
    const el = document.getElementById(id); el.min = DOMAIN.yearMin; el.max = DOMAIN.yearMax;
  });

  buildChips("leagueChips", "league");
  buildChips("roleChips", "role");
  buildChips("throwsChips", "throws");
  buildFranchiseList();
  buildPlayerIndex();
  wire();
  resetState();
  applyUrlParams();
}

/* ---------------- URL deep links ---------------- */
function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  if (![...p.keys()].length) return;
  if (p.has("measure") && MEASURES[p.get("measure")]) state.measure = p.get("measure");
  if (p.has("breakdown") && BREAKDOWNS[p.get("breakdown")]) state.breakdown = p.get("breakdown");
  if (p.has("trend")) state.trendMode = p.get("trend") === "split" ? "split" : "all";
  if (p.has("yearMin")) state.yearMin = Math.max(DOMAIN.yearMin, Math.min(DOMAIN.yearMax, +p.get("yearMin") || state.yearMin));
  if (p.has("yearMax")) state.yearMax = Math.max(DOMAIN.yearMin, Math.min(DOMAIN.yearMax, +p.get("yearMax") || state.yearMax));
  ["franchise", "league", "role", "throws"].forEach(k => {
    if (p.has(k) && DOMAIN[k].includes(p.get(k))) state[k] = new Set([p.get(k)]);
  });
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

/* ---------------- pitcher lookup ---------------- */
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
  window._pitcherLabelToId = new Map(options.map(o => [o.label, o.id]));
}

function showPlayer(id) {
  const rows = PLAYERS.get(id);
  if (!rows) return;
  const seasons = [...rows].sort((a, b) => a.year - b.year);
  const t = totalsOf(seasons);
  const years = seasons.map(r => r.year);
  const roleCounts = groupBy(seasons, r => r.role);
  const mainRole = [...roleCounts.entries()].sort((a, b) => b[1].rows - a[1].rows)[0][0];

  document.getElementById("playerResult").hidden = false;
  document.getElementById("playerResult").innerHTML = `
    <div class="player-result-head">
      <h3>${seasons[0].name}</h3>
      <span>${Math.min(...years)}–${Math.max(...years)} · ${mainRole} · Throws ${seasons[0].throws}</span>
    </div>
    <div class="player-tiles">
      <div class="tile"><div class="tile-value">${fmt(t.rows, "int")}</div><div class="tile-label">Seasons</div></div>
      <div class="tile"><div class="tile-value">${fmt(ip(t), "int")}</div><div class="tile-label">Innings</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.W, "int")}–${fmt(t.L, "int")}</div><div class="tile-label">W–L</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.SO, "int")}</div><div class="tile-label">Strikeouts (K)</div></div>
      <div class="tile"><div class="tile-value">${fmt(t.SV, "int")}</div><div class="tile-label">Saves</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "ERA"), "dec2")}</div><div class="tile-label">ERA</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "WHIP"), "dec2")}</div><div class="tile-label">WHIP</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "K9"), "dec2")}</div><div class="tile-label">K/9</div></div>
      <div class="tile"><div class="tile-value">${fmt(val(t, "BB9"), "dec2")}</div><div class="tile-label">BB/9</div></div>
    </div>
    <div class="player-chart-head">
      <label for="playerMeasure">Season by season</label>
      <select id="playerMeasure">${Object.entries(MEASURES).map(([k, m]) => `<option value="${k}" ${k === "ERA" ? "selected" : ""}>${m.label}</option>`).join("")}</select>
    </div>
    <div class="chart-box" style="height:220px"><canvas id="c-player" role="img" aria-label="Pitcher season by season"></canvas></div>`;

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
  draw("ERA");
  document.getElementById("playerMeasure").addEventListener("change", e => draw(e.target.value));
  document.getElementById("playerCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetState() {
  Object.assign(state, {
    yearMin: DOMAIN.yearMin, yearMax: DOMAIN.yearMax,
    franchise: new Set(DOMAIN.franchise), league: new Set(DOMAIN.league),
    role: new Set(DOMAIN.role), throws: new Set(DOMAIN.throws), minBF: 0,
    measure: "K9", breakdown: "role", trendMode: "split",
  });
  syncInputs();
  update();
}

function syncInputs() {
  const set = (id, v) => (document.getElementById(id).value = v);
  set("yearMin", state.yearMin); set("yearMax", state.yearMax);
  set("yearMinSlider", state.yearMin); set("yearMaxSlider", state.yearMax);
  set("minBF", state.minBF); set("measure", state.measure); set("breakdown", state.breakdown);
  document.getElementById("minBFLabel").textContent = state.minBF;
  document.getElementById("franchiseSearch").value = "";
  filterFranchiseList("");
  ["league", "role", "throws"].forEach(k =>
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

  const minBF = document.getElementById("minBF");
  minBF.addEventListener("input", e => (document.getElementById("minBFLabel").textContent = e.target.value));
  minBF.addEventListener("change", e => { state.minBF = +e.target.value; update(); });

  document.getElementById("measure").addEventListener("change", e => { state.measure = e.target.value; update(); });
  document.getElementById("breakdown").addEventListener("change", e => { state.breakdown = e.target.value; tableSort = { key: "IP", dir: -1 }; update(); });
  document.getElementById("trendMode").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.trendMode = b.dataset.v; syncInputs(); update();
  });
  document.getElementById("reset").addEventListener("click", resetState);

  document.querySelectorAll("[data-save]").forEach(b => b.addEventListener("click", () => {
    const c = charts[b.dataset.save]; if (c) downloadChart(c, `mlb-pitching-${b.dataset.save}-${state.measure}`);
  }));
  document.getElementById("exportCsv").addEventListener("click", exportTable);

  document.getElementById("playerSearch").addEventListener("input", e => {
    const id = window._pitcherLabelToId?.get(e.target.value);
    if (id) showPlayer(id);
  });
}

/* ---------------- filtering + aggregation ---------------- */
function filtered() {
  const s = state;
  return DATA.filter(r =>
    r.year >= s.yearMin && r.year <= s.yearMax && r.BFP >= s.minBF &&
    s.franchise.has(r.franchise) && s.league.has(r.league) && s.role.has(r.role) && s.throws.has(r.throws));
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
  document.getElementById("status").textContent = `Showing ${fmt(rows.length, "int")} of ${fmt(DATA.length, "int")} pitcher-seasons`;
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
  document.getElementById("heatmap").innerHTML = `<p class="empty">No pitcher-seasons match these filters. Widen a filter or press Reset all filters.</p>`;
  document.getElementById("table").innerHTML = "";
}

/* ---------------- summary numbers ---------------- */
function drawKpis(t) {
  const tiles = [
    ["Pitcher-seasons", fmt(t.rows, "int")],
    ["Innings pitched", compact(ip(t))],
    ["Wins (W)", fmt(t.W, "int")],
    ["Strikeouts (K)", fmt(t.SO, "int")],
    ["Saves (SV)", fmt(t.SV, "int")],
    ["ERA", fmt(val(t, "ERA"), "dec2")],
    ["WHIP", fmt(val(t, "WHIP"), "dec2")],
    ["Strikeouts per 9 (K/9)", fmt(val(t, "K9"), "dec2")],
    [M().label, fmt(val(t), M().kind)],
  ];
  document.getElementById("kpis").innerHTML = tiles.map(([l, v]) =>
    `<div class="tile"><div class="tile-value">${t.rows ? v : "–"}</div><div class="tile-label">${l}</div></div>`).join("");
}

/* ---------------- charts ---------------- */
function axisFor(kind) {
  if (kind === "pct") return { ticks: { callback: v => (v * 100).toFixed(1) + "%" } };
  if (kind === "dec2") return { ticks: { callback: v => v.toFixed(1) } };
  return { ticks: { callback: v => compact(v) } };
}
function make(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById("c-" + id), config);
}
const topKeys = (groups, n) => [...groups.entries()].sort((a, b) => b[1].BFP - a[1].BFP).slice(0, n).map(([k]) => k);

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
    datasets = [{ label: "All selected", borderColor: COLORS[0], backgroundColor: "rgba(11,37,69,.08)", fill: true,
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
  const m = M();
  const entries = [...groups.entries()];
  const vals = entries.map(([, t]) => val(t));
  const maxV = Math.max(...vals.filter(v => v != null && v > 0), 1e-9);
  document.getElementById("t-scatter").textContent = `Strikeout rate vs. walk rate by ${BREAKDOWNS[state.breakdown].toLowerCase()}`;
  document.getElementById("n-scatter").textContent = `Each bubble is one group; bubble size shows ${m.label}. Click one to filter to it.`;
  make("scatter", {
    type: "bubble",
    data: { datasets: entries.map(([k, t], i) => ({
      label: k, backgroundColor: COLORS[i % COLORS.length] + "b3", borderColor: COLORS[i % COLORS.length],
      data: [{ x: val(t, "K_PCT"), y: val(t, "BB_PCT"), r: 4 + 18 * Math.sqrt(Math.max(0, vals[i] ?? 0) / maxV), v: vals[i] }],
    })) },
    options: {
      interaction: { mode: "nearest", intersect: true },
      onClick: (evt, els) => { if (els.length) { const lab = entries[els[0].datasetIndex][0]; setTimeout(() => drillDown(state.breakdown, lab), 0); } },
      plugins: { legend: { display: entries.length <= 10 },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: K ${fmt(c.parsed.x, "pct")}, BB ${fmt(c.parsed.y, "pct")}, ${m.label} ${fmt(c.raw.v, m.kind)}` } } },
      scales: { x: { title: { display: true, text: "Strikeout rate (higher is better for the pitcher)" }, ...axisFor("pct") }, y: { title: { display: true, text: "Walk rate (lower is better)" }, ...axisFor("pct") } },
    },
  });
}

function drawLeaders(rows) {
  const m = M();
  const players = groupBy(rows, r => r.playerID);
  const names = new Map(rows.map(r => [r.playerID, r.name]));
  // the group each pitcher belongs to in this view: the one where he faced the most batters
  const best = new Map();
  rows.forEach(r => { const b = best.get(r.playerID); if (!b || r.BFP > b.w) best.set(r.playerID, { w: r.BFP, g: r[state.breakdown] }); });
  let list = [...players.entries()];
  if (m.rate) list = list.filter(([, t]) => t.BFP >= LEADER_MIN_BFP);
  list = list.map(([id, t]) => [id, names.get(id), val(t), best.get(id).g]).filter(e => e[2] != null)
    .sort((a, b) => (m.lower ? a[2] - b[2] : b[2] - a[2])).slice(0, 10);
  document.getElementById("t-leaders").textContent = `Top 10 pitchers: ${m.label}${m.lower ? " (lowest)" : ""}, colored by ${BREAKDOWNS[state.breakdown].toLowerCase()}`;
  document.getElementById("n-leaders").textContent = (m.rate
    ? `Pitchers who faced at least ${fmt(LEADER_MIN_BFP, "int")} batters in the current view. Totals are summed across the filtered seasons.`
    : "Totals are summed across the filtered seasons and teams.") + " Click a bar to look up that pitcher.";
  const groups = [...new Set(list.map(e => e[3]))];
  make("leaders", {
    type: "bar",
    data: { labels: list.map(e => e[1]), datasets: groups.map((g, i) => ({ label: g, data: list.map(e => (e[3] === g ? e[2] : null)), backgroundColor: COLORS[i % COLORS.length] })) },
    options: {
      indexAxis: "y", interaction: { mode: "nearest", intersect: true },
      onClick: (evt, els) => { if (els.length) { const id = list[els[0].index][0]; setTimeout(() => showPlayer(id), 0); } },
      plugins: { legend: { display: groups.length > 1 }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.x, m.kind)}` } } },
      scales: { x: { stacked: true, ...axisFor(m.kind) }, y: { stacked: true, ticks: { autoSkip: false, font: { size: 11 } } } },
    },
  });
}

function drawHist(rows) {
  const m = M(), bk = state.breakdown;
  // Which per-row value to plot for each counting measure
  const rowKey = { rows: "BFP", medSO: "SO", medIP: "IP", IP: "IP", G: "G", GS: "GS", CG: "CG", SHO: "SHO", W: "W", L: "L", SV: "SV", SO: "SO", BB: "BB", HR: "HR", H: "H", ER: "ER" }[state.measure];
  const labels0 = { BFP: "Batters faced", IP: "Innings", G: "Games", GS: "Games started", CG: "Complete games", SHO: "Shutouts", W: "Wins", L: "Losses", SV: "Saves", SO: "Strikeouts", BB: "Walks", HR: "Home runs allowed", H: "Hits allowed", ER: "Earned runs" };
  let items, kind = m.kind, label;
  if (m.rate) {
    items = rows.filter(r => r.BFP >= HIST_MIN_BFP).map(r => { const t = emptyTotals(); addRow(t, r); return { v: val(t), g: r[bk] }; }).filter(it => it.v != null);
    label = m.label;
    document.getElementById("n-hist").textContent = `Pitcher-seasons with at least ${HIST_MIN_BFP} batters faced (${fmt(items.length, "int")} shown).`;
  } else {
    items = rows.map(r => ({ v: (rowKey === "IP" ? r.IPouts / 3 : r[rowKey]), g: r[bk] })); kind = "int";
    label = labels0[rowKey] + " per pitcher-season";
    document.getElementById("n-hist").textContent = `All ${fmt(items.length, "int")} pitcher-seasons in the current view.`;
  }
  document.getElementById("t-hist").textContent = `Distribution: ${label}, stacked by ${BREAKDOWNS[bk].toLowerCase()}`;
  if (!items.length) { charts.hist?.destroy(); return; }
  // 20 equal-width bins from the 1st to 99th percentile so outliers don't flatten the chart
  const s = items.map(it => it.v).sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * 0.01)], hi = s[Math.floor(s.length * 0.99)] || lo + 1;
  const n = 20, w = (hi - lo) / n || 1;
  const bin = v => Math.min(n - 1, Math.max(0, Math.floor((v - lo) / w)));
  // one stack per group: the six largest groups, and everything else together
  const sizes = new Map();
  items.forEach(it => sizes.set(it.g, (sizes.get(it.g) || 0) + 1));
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const keep = new Set(ranked.length > 7 ? ranked.slice(0, 6) : ranked);
  const stacks = new Map();
  items.forEach(it => {
    const g = keep.has(it.g) ? it.g : "All other groups";
    if (!stacks.has(g)) stacks.set(g, new Array(n).fill(0));
    stacks.get(g)[bin(it.v)]++;
  });
  const fk = kind === "int" ? "dec1" : kind;
  const labels = Array.from({ length: n }, (_, i) => fmt(lo + i * w, fk));
  make("hist", {
    type: "bar",
    data: { labels, datasets: [...stacks.entries()].map(([g, data], i) => ({ label: g, data, backgroundColor: COLORS[i % COLORS.length], barPercentage: 1, categoryPercentage: 0.95 })) },
    options: {
      plugins: { legend: { display: stacks.size > 1 },
        tooltip: { callbacks: { title: c => `${labels[c[0].dataIndex]} to ${fmt(lo + (c[0].dataIndex + 1) * w, fk)}`, label: c => `${c.dataset.label}: ${fmt(c.parsed.y, "int")} pitcher-seasons` } } },
      scales: { x: { stacked: true, ticks: { maxTicksLimit: 8 } }, y: { stacked: true, title: { display: true, text: "Pitcher-seasons" } } },
    },
  });
}

/* Heatmap: breakdown values (rows) x decades (columns), colored by the measure */
function drawHeatmap(rows) {
  const m = M(), bk = state.breakdown === "decade" ? "league" : state.breakdown;
  const cells = groupBy(rows, r => r[bk] + "|" + r.decade);
  const decades = [...new Set(rows.map(r => r.decade))].sort();
  const keys = [...groupBy(rows, r => r[bk]).entries()].sort((a, b) => b[1].BFP - a[1].BFP).map(([k]) => k);
  const vals = [...cells.values()].map(t => val(t)).filter(v => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const color = v => {
    if (v == null) return "background:#eef0ec;color:#99a";
    const p = hi === lo ? 0.5 : (v - lo) / (hi - lo);
    const l = 94 - p * 64;                              // light to dark green
    return `background:hsl(214,55%,${l}%);color:${l < 55 ? "#fff" : "#1a2230"}`;
  };
  document.getElementById("t-heat").textContent = `${m.label}: ${BREAKDOWNS[bk].toLowerCase()} by decade`;
  document.getElementById("heatmap").innerHTML = `
    <table class="heatmap">
      <thead><tr><th>${BREAKDOWNS[bk]}</th>${decades.map(d => `<th>${d}</th>`).join("")}</tr></thead>
      <tbody>${keys.map(k => `<tr><th>${k}</th>${decades.map(d => {
        const t = cells.get(k + "|" + d), v = t ? val(t) : null;
        return `<td style="${color(v)}" title="${k}, ${d}: ${fmt(v, m.kind)}">${fmt(v, m.kind)}</td>`;
      }).join("")}</tr>`).join("")}</tbody>
    </table>
    ${state.breakdown === "decade" ? '<p class="chart-note">Decade is already the column, so rows show league.</p>' : ""}`;
}

/* ---------------- table ---------------- */
const TABLE_COLS = [
  ["group", null], ["rows", "int"], ["IP", "int"], ["W", "int"], ["L", "int"], ["SV", "int"], ["SO", "int"],
  ["ERA", "dec2"], ["WHIP", "dec2"], ["K9", "dec2"], ["BB9", "dec2"], ["HR9", "dec2"], ["K_PCT", "pct"], ["BB_PCT", "pct"],
];
const HEAD = { group: null, rows: "Pitcher-seasons", IP: "IP", W: "W", L: "L", SV: "SV", SO: "K", ERA: "ERA", WHIP: "WHIP", K9: "K/9", BB9: "BB/9", HR9: "HR/9", K_PCT: "K%", BB_PCT: "BB%" };

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
  downloadCSV(out, `mlb-pitching-${state.breakdown}-${state.yearMin}-${state.yearMax}`);
}
})();
