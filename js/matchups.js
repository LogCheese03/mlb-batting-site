/* ------------------------------------------------------------------
   matchups.js: hitter-vs-pitcher lookup, season by season, 1960-2026.
   Every batter-pitcher pairing is included. The page loads a small
   index of all players, then fetches one file for the hitter or pitcher
   you pick (data/matchups/b/<id>.csv or p/<id>.csv). The files are
   built by scripts/build_matchups.py from Retrosheet play-by-play
   (1960-2025) and MLB's Stats API play-by-play (2026).
   Rates use the same formulas as the rest of the site, computed from
   totals: AVG = H / AB, OBP = (H + BB + HBP) / (AB + BB + HBP + SF),
   SLG = (H + 2B + 2*3B + 3*HR) / AB, OPS = OBP + SLG.
------------------------------------------------------------------- */
(function () {
applyChartTheme();

const COLS = ["PA", "AB", "H", "2B", "3B", "HR", "BB", "HBP", "SO", "SF"];
const $ = id => document.getElementById(id);
const SHOW_ROWS = 250;        // opponent rows drawn before "Show all"

let PLAYERS = [];             // index -> { retro, name, first, last, bPA, pPA }
let TOP_PAIRS = [];
const cache = new Map();      // "b/bondb001" -> parsed shard
const state = { mode: "hitter", primary: null, opp: null, measure: "OPS", minPA: 1, sort: { key: "PA", dir: -1 }, showAll: false };
let shard = null;             // the loaded file for the primary player
let chart = null, oppChart = null, oppRows = [], seasonRows = [];

/* ---------------- load the index ---------------- */
fetch("data/matchups/index.json?v=" + DATA_VERSION)
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(idx => {
    PLAYERS = idx.players.map(([retro, name, first, last, bPA, pPA]) => ({ retro, name, first, last, bPA, pPA }));
    TOP_PAIRS = idx.top;
    init();
    $("loading").hidden = true;
  })
  .catch(err => {
    $("loading").textContent = "Could not load the matchup index (" + err.message + "). Serve the site through a web server; see the README.";
    console.error(err);
  });

/* accuracy note: numbers come from data/matchups_meta.json, written by build_matchups.py */
fetch("data/matchups_meta.json?v=" + DATA_VERSION).then(r => r.json()).then(m => {
  const pct2 = v => (v * 100).toFixed(2) + "%", pct1 = v => (v * 100).toFixed(1) + "%";
  $("mmTol").textContent = pct2(Math.max(m.worst_relative_difference_1970_on, 0.0001));
  $("mmWorst").textContent = pct2(m.worst_relative_difference_vs_site);
  $("mmExact").textContent = pct1(m.pitcher_check.exact_share);
}).catch(() => {});

/* ---------------- one player's file ---------------- */
async function loadShard(role, idx) {
  const retro = PLAYERS[idx].retro, key = role + "/" + retro;
  if (cache.has(key)) return cache.get(key);
  const res = await fetch(`data/matchups/${key}.csv?v=${DATA_VERSION}`);
  if (!res.ok) throw new Error(key + ": " + res.status);
  const lines = (await res.text()).split("\n");
  const n = lines.length;
  const cols = ["opp", "year", ...COLS], col = {};
  cols.forEach(c => (col[c] = new Int32Array(n)));
  let i = 0;
  for (const line of lines) {
    if (!line) continue;
    const f = line.split(",");
    for (let k = 0; k < cols.length; k++) col[cols[k]][i] = +f[k];
    i++;
  }
  // rows are sorted by opponent then year, so each opponent is one contiguous block
  const blocks = [];
  let s = 0;
  for (let r = 1; r <= i; r++) {
    if (r === i || col.opp[r] !== col.opp[s]) { blocks.push({ o: col.opp[s], s, e: r }); s = r; }
  }
  const parsed = { col, n: i, blocks };
  cache.set(key, parsed);
  return parsed;
}

/* ---------------- stats for a block of rows ---------------- */
function sumRange(col, s, e) {
  const t = Object.fromEntries(COLS.map(c => [c, 0]));
  for (let k = s; k < e; k++) for (const c of COLS) t[c] += col[c][k];
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
const nameOf = i => PLAYERS[i].name;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* ---------------- type-ahead search (10,000+ names) ---------------- */
function attachSearch(inputId, listId, candidates, onPick) {
  const input = $(inputId), list = $(listId);
  let shown = [], active = -1;
  const label = i => `${PLAYERS[i].name} (${PLAYERS[i].first}–${PLAYERS[i].last})`;
  const render = () => {
    list.hidden = !shown.length;
    list.innerHTML = shown.map((i, k) => `<li role="option" data-i="${i}" class="${k === active ? "active" : ""}">${esc(label(i))}</li>`).join("");
  };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { shown = []; render(); return; }
    const words = q.split(/\s+/);
    shown = candidates().filter(i => { const n = PLAYERS[i].name.toLowerCase(); return words.every(w => n.includes(w)); })
      .sort((a, b) => {
        const an = PLAYERS[a].name.toLowerCase().startsWith(q) ? 0 : 1, bn = PLAYERS[b].name.toLowerCase().startsWith(q) ? 0 : 1;
        return an - bn || (PLAYERS[b].bPA + PLAYERS[b].pPA) - (PLAYERS[a].bPA + PLAYERS[a].pPA);
      }).slice(0, 12);
    active = shown.length ? 0 : -1;
    render();
  };
  const pick = i => { input.value = label(i); shown = []; render(); onPick(i); };
  input.addEventListener("input", update);
  input.addEventListener("focus", update);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { active = Math.min(shown.length - 1, active + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); render(); e.preventDefault(); }
    else if (e.key === "Enter" && shown[active] != null) { pick(shown[active]); e.preventDefault(); }
    else if (e.key === "Escape") { shown = []; render(); }
  });
  list.addEventListener("mousedown", e => { const li = e.target.closest("li"); if (li) { e.preventDefault(); pick(+li.dataset.i); } });
  input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) { shown = []; render(); } }, 150));
}

/* ---------------- setup ---------------- */
function init() {
  $("measure").innerHTML = Object.entries(MEASURES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("measure").value = state.measure;
  $("topPairs").innerHTML = TOP_PAIRS.map(([b, p, pa], i) =>
    `<li><button class="linkish" data-i="${i}">${esc(nameOf(b))} vs. ${esc(nameOf(p))}</button> <span class="count">${pa} PA</span></li>`).join("");
  $("playerCount").textContent = PLAYERS.length.toLocaleString("en-US");

  const all = PLAYERS.map((_, i) => i);
  attachSearch("playerSearch", "playerSuggest",
    () => all.filter(i => (state.mode === "hitter" ? PLAYERS[i].bPA : PLAYERS[i].pPA) > 0),
    i => selectPrimary(i));
  attachSearch("oppSearch", "oppSuggest",
    () => (shard ? shard.blocks.map(b => b.o) : []),
    i => { state.opp = i; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); });

  document.querySelectorAll("#modeSeg button").forEach(b => b.addEventListener("click", () => {
    state.mode = b.dataset.v; state.primary = null; state.opp = null; shard = null;
    $("playerSearch").value = ""; $("oppSearch").value = ""; render();
  }));
  $("measure").addEventListener("change", e => { state.measure = e.target.value; render(); });
  $("minPA").addEventListener("input", e => ($("minPALabel").textContent = e.target.value));
  $("minPA").addEventListener("change", e => { state.minPA = +e.target.value; render(); });
  $("reset").addEventListener("click", () => {
    Object.assign(state, { primary: null, opp: null, measure: "OPS", minPA: 1, sort: { key: "PA", dir: -1 }, showAll: false });
    shard = null; $("measure").value = "OPS"; $("minPA").value = 1; $("minPALabel").textContent = 1;
    $("playerSearch").value = ""; $("oppSearch").value = ""; render();
  });
  $("topPairs").addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    const [bi, pi] = TOP_PAIRS[+b.dataset.i];
    state.mode = "hitter";
    $("playerSearch").value = `${nameOf(bi)} (${PLAYERS[bi].first}–${PLAYERS[bi].last})`;
    await selectPrimary(bi, pi);
  });
  $("exportCsv").addEventListener("click", exportSeasons);
  $("showAll").addEventListener("click", () => { state.showAll = true; render(); });
  $("oppTable").addEventListener("click", e => {
    const th = e.target.closest("th[data-k]");
    if (th) { const k = th.dataset.k; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (k === "name" ? 1 : -1) }; render(); return; }
    const tr = e.target.closest("tr[data-o]");
    if (tr) { state.opp = +tr.dataset.o; $("oppSearch").value = ""; render(); $("detail").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  applyUrl();
  render();
}

async function selectPrimary(idx, opp = null) {
  state.primary = idx; state.opp = opp; state.showAll = false;
  $("oppSearch").value = "";
  $("status").textContent = "Loading " + nameOf(idx) + "…";
  try {
    shard = await loadShard(state.mode === "hitter" ? "b" : "p", idx);
    $("status").textContent = "Switch the measure to change both charts.";
  } catch (err) {
    shard = null; $("status").textContent = "Could not load that player's file (" + err.message + ").";
  }
  render();
}

function applyUrl() {
  const p = new URLSearchParams(location.search);
  const find = r => PLAYERS.findIndex(x => x.retro === r);
  const a = find(p.get("b")), c = find(p.get("p"));
  if (p.get("mode") === "pitcher" && c >= 0) { state.mode = "pitcher"; selectPrimary(c, a >= 0 ? a : null); }
  else if (a >= 0) { state.mode = "hitter"; selectPrimary(a, c >= 0 ? c : null); }
}

/* ---------------- render ---------------- */
function render() {
  document.querySelectorAll("#modeSeg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.v === state.mode));
  const hitter = state.mode === "hitter";
  $("playerLabel").textContent = hitter ? "Pick a hitter" : "Pick a pitcher";
  $("playerSearch").placeholder = hitter ? "Type a hitter's name…" : "Type a pitcher's name…";
  $("oppLabel").textContent = hitter ? "Then a pitcher" : "Then a hitter";
  $("oppSearch").placeholder = hitter ? "Type a pitcher's name…" : "Type a hitter's name…";
  if (state.primary != null && !$("playerSearch").value) {
    const P = PLAYERS[state.primary]; $("playerSearch").value = `${P.name} (${P.first}–${P.last})`;
  }
  drawOpponents();
  drawDetail();
}

function drawOpponents() {
  const card = $("oppCard");
  if (state.primary == null || !shard) { card.hidden = true; $("prompt").hidden = false; return; }
  card.hidden = false; $("prompt").hidden = true;
  const hitter = state.mode === "hitter";
  const P = PLAYERS[state.primary];
  const all = shard.blocks.map(x => {
    const t = sumRange(shard.col, x.s, x.e);
    return { o: x.o, name: nameOf(x.o), yrs: `${shard.col.year[x.s]}–${shard.col.year[x.e - 1]}`, t,
      PA: t.PA, AB: t.AB, H: t.H, HR: t.HR, BB: t.BB, SO: t.SO, AVG: rateOf(t, "AVG"), OBP: rateOf(t, "OBP"), SLG: rateOf(t, "SLG"), OPS: rateOf(t, "OPS") };
  });
  oppRows = all.filter(r => r.PA >= state.minPA);
  const { key, dir } = state.sort;
  oppRows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key]) * dir : ((a[key] ?? -1) - (b[key] ?? -1)) * dir));

  $("oppTitle").textContent = `${P.name} against ${all.length.toLocaleString("en-US")} ${hitter ? "pitchers" : "hitters"} (${P.first}–${P.last})`;
  $("oppNote").textContent = `Career totals over every season in this data (1960–2026). ${oppRows.length.toLocaleString("en-US")} ${hitter ? "pitchers" : "hitters"} shown` +
    (state.minPA > 1 ? ` with at least ${state.minPA} plate appearances` : "") + ". Click a row to see the season-by-season line.";

  const shown = state.showAll ? oppRows : oppRows.slice(0, SHOW_ROWS);
  $("showAll").hidden = state.showAll || oppRows.length <= SHOW_ROWS;
  $("showAll").textContent = `Show all ${oppRows.length.toLocaleString("en-US")} rows`;

  const cols = [["name", hitter ? "Pitcher" : "Hitter"], ["yrs", "Seasons"], ["PA", "PA"], ["AB", "AB"], ["H", "H"], ["HR", "HR"], ["BB", "BB"], ["SO", "SO"], ["AVG", "AVG"], ["OBP", "OBP"], ["SLG", "SLG"], ["OPS", "OPS"]];
  const kinds = { PA: "int", AB: "int", H: "int", HR: "int", BB: "int", SO: "int", AVG: "avg", OBP: "avg", SLG: "avg", OPS: "avg" };
  $("oppTable").innerHTML = `
    <thead><tr>${cols.map(([k, h]) => `<th data-k="${k}" tabindex="0" ${k === key ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${h}</th>`).join("")}</tr></thead>
    <tbody>${shown.map(r => `<tr data-o="${r.o}" class="${r.o === state.opp ? "selected" : ""}" tabindex="0">${cols.map(([k]) => `<td>${kinds[k] ? fmt(r[k], kinds[k]) : esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody>`;
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
  const blk = shard && state.opp != null ? shard.blocks.find(x => x.o === state.opp) : null;
  if (state.primary == null || !blk) { card.hidden = true; return; }
  card.hidden = false;
  const hitter = state.mode === "hitter";
  const bName = hitter ? nameOf(state.primary) : nameOf(state.opp);
  const pName = hitter ? nameOf(state.opp) : nameOf(state.primary);
  $("detailTitle").textContent = `${bName} vs. ${pName}`;

  const col = shard.col;
  seasonRows = [];
  for (let k = blk.s; k < blk.e; k++) {
    const t = Object.fromEntries(COLS.map(c => [c, col[c][k]]));
    seasonRows.push({ year: col.year[k], t });
  }
  const total = sumRange(col, blk.s, blk.e);

  $("detailKpis").innerHTML = [
    ["Plate appearances", fmt(total.PA, "int")], ["AVG", fmt(rateOf(total, "AVG"), "avg")], ["OBP", fmt(rateOf(total, "OBP"), "avg")],
    ["SLG", fmt(rateOf(total, "SLG"), "avg")], ["OPS", fmt(rateOf(total, "OPS"), "avg")], ["Home runs", fmt(total.HR, "int")],
    ["Strikeouts", fmt(total.SO, "int")], ["Walks", fmt(total.BB, "int")],
  ].map(([l, v]) => `<div class="tile"><div class="tile-value">${v}</div><div class="tile-label">${l}</div></div>`).join("");

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
    : [line, { type: "bar", label: "Plate appearances", data: seasonRows.map(r => r.t.PA), backgroundColor: "rgba(11,37,69,.25)", yAxisID: "y1", order: 2 }];
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
