/* ------------------------------------------------------------------
   report.js: fills every number on index.html from data/report.json
   and draws the charts. No number on the report is typed by hand.
------------------------------------------------------------------- */
applyChartTheme();

const charts = {};
let REP, D;

fetch("data/report.json")
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(rep => { REP = rep; D = derive(rep); fillNumbers(); countUp(); drawAll(); wireToggles(); buildToc(); })
  .catch(err => {
    document.getElementById("findings").insertAdjacentHTML("afterbegin",
      `<p class="empty">Could not load data/report.json (${err.message}). Run <code>python scripts/prep_data.py</code>, then open the site through a web server (see README).</p>`);
  });

/* ---------------- numbers computed from report.json ---------------- */
function derive(rep) {
  const s = rep.season;
  const maxBy = (arr, k) => arr.reduce((a, b) => (b[k] > a[k] ? b : a));
  const minBy = (arr, k) => arr.reduce((a, b) => (b[k] < a[k] ? b : a));
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

  // AL minus NL OPS by season
  const byYear = {};
  rep.league_season.forEach(x => { (byYear[x.year] ||= {})[x.league] = x.OPS; });
  const gaps = Object.entries(byYear).filter(([, v]) => v.AL != null && v.NL != null).map(([y, v]) => ({ y: +y, g: v.AL - v.NL }));
  const gapMean = (lo, hi) => mean(gaps.filter(x => x.y >= lo && x.y <= hi).map(x => x.g));

  const posPlayers = rep.position.filter(p => !["Pitcher", "DH / pinch hitter"].includes(p.pos));
  const pitcher = rep.position.find(p => p.pos === "Pitcher");

  const bd = rep.bats_decade, nDec = bd.decades.length;
  const xbh = rep.decade_xbh;

  return {
    kPeakYear: maxBy(s, "K_PCT").year, kPeak: maxBy(s, "K_PCT").K_PCT,
    hrPeakYear: maxBy(s, "HR_PCT").year, hrPeak: maxBy(s, "HR_PCT").HR_PCT,
    baMaxYear: maxBy(s, "BA").year, baMax: maxBy(s, "BA").BA,
    baMinYear: minBy(s, "BA").year, baMin: minBy(s, "BA").BA,
    ttoFirst: s[0].TTO_PCT, ttoLast: s[s.length - 1].TTO_PCT,
    sbPeakYear: maxBy(s, "SB_PER_TEAM").year, sbPeak: maxBy(s, "SB_PER_TEAM").SB_PER_TEAM,
    sbLast: s[s.length - 1].SB_PER_TEAM,
    dhGap: gapMean(1973, 2021), preGap: gapMean(0, 1972), postGap: gapMean(2022, 9999),
    topFranchise: rep.franchise[0].franchise, topFranchiseHR: rep.franchise[0].HR,
    topPos: maxBy(posPlayers, "OPS").pos, topPosOPS: maxBy(posPlayers, "OPS").OPS,
    lowPos: minBy(posPlayers, "OPS").pos, lowPosOPS: minBy(posPlayers, "OPS").OPS,
    pitcherOPS: pitcher ? pitcher.OPS : null,
    firstDecade: bd.decades[0], lastDecade: bd.decades[nDec - 1],
    leftFirst: bd.series.Left?.[0], leftLast: bd.series.Left?.[nDec - 1],
    switchFirst: bd.series.Switch?.[0], switchLast: bd.series.Switch?.[nDec - 1],
    triplesFirst: xbh[0]["3B_PER_600"], triplesLast: xbh[xbh.length - 1]["3B_PER_600"],
    doublesFirst: xbh[0]["2B_PER_600"], doublesLast: xbh[xbh.length - 1]["2B_PER_600"],
    droppedWindow: rep.meta.raw_rows - rep.meta.rows_in_window,
  };
}

function lookup(path) {
  const [root, ...rest] = path.split(".");
  let v = root === "d" ? D : REP[root];
  for (const k of rest) v = v?.[k];
  return v;
}
function format(v, kind) {
  if (kind === "signavg") return v == null ? "–" : (v >= 0 ? "+" : "−") + fmt(Math.abs(v), "avg");
  return kind ? fmt(v, kind) : (v ?? "–");
}
function fillNumbers() {
  document.querySelectorAll("[data-fill]").forEach(el => {
    const [path, kind] = el.dataset.fill.split("|");
    el.textContent = format(lookup(path), kind);
  });
}

/* The one orchestrated motion on the page: scoreboard numbers count up on load */
function countUp() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll("[data-count]").forEach(el => {
    const [path, kind] = el.dataset.count.split("|");
    const target = lookup(path);
    if (reduce || target == null) { el.textContent = fmt(target, kind); return; }
    const t0 = performance.now(), dur = 1400;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(target * e), kind);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/* ---------------- charts ---------------- */
const years = () => REP.season.map(x => x.year);
const pctAxis = { ticks: { callback: v => (v * 100).toFixed(0) + "%" } };
const avgAxis = { ticks: { callback: v => fmt(v, "avg") } };
const tip = kind => ({ callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y ?? c.parsed.x, kind)}` } });

function line(id, labels, datasets, kind, extra = {}) {
  charts[id]?.destroy();
  charts[id] = new Chart(document.getElementById("c-" + id), {
    type: "line",
    data: { labels, datasets },
    options: {
      plugins: { tooltip: tip(kind), legend: { display: datasets.length > 1 }, ...extra.plugins },
      scales: { y: kind === "pct" ? pctAxis : kind === "avg" ? avgAxis : {}, x: { ticks: { maxTicksLimit: 14 } } },
    },
    plugins: extra.inline || [],
  });
}

function drawStrikeouts() {
  line("strikeouts", years(), [{ label: "Strikeout rate", data: REP.season.map(x => x.K_PCT), borderColor: COLORS[1], backgroundColor: "rgba(200,16,46,.08)", fill: true }], "pct");
}
function drawHomers(v = "HR_PCT") {
  const kind = v === "HR_PCT" ? "pct" : "dec1";
  document.getElementById("t-homers").textContent = v === "HR_PCT" ? "Home runs per plate appearance, by season" : "Home runs per team, by season";
  line("homers", years(), [{ label: v === "HR_PCT" ? "HR rate" : "HR per team", data: REP.season.map(x => x[v]), borderColor: COLORS[0], backgroundColor: "rgba(22,57,42,.08)", fill: true }], kind);
}
function drawAverage(v = "BA") {
  line("average", years(), [{ label: v, data: REP.season.map(x => x[v]), borderColor: COLORS[2] }], "avg");
}
function drawTto() {
  const mk = (k, label, c) => ({ label, data: REP.season.map(x => x[k]), borderColor: c, backgroundColor: c + "cc", fill: true, borderWidth: 1 });
  charts.tto?.destroy();
  charts.tto = new Chart(document.getElementById("c-tto"), {
    type: "line",
    data: { labels: years(), datasets: [mk("HR_PCT", "Home runs", COLORS[0]), mk("BB_PCT", "Walks", COLORS[3]), mk("K_PCT", "Strikeouts", COLORS[1])] },
    options: { plugins: { tooltip: tip("pct") }, scales: { y: { stacked: true, ...pctAxis }, x: { ticks: { maxTicksLimit: 14 } } } },
  });
}
function drawSteals() {
  charts.steals?.destroy();
  const peak = D.sbPeakYear;
  charts.steals = new Chart(document.getElementById("c-steals"), {
    type: "bar",
    data: { labels: years(), datasets: [{ label: "Stolen bases per team", data: REP.season.map(x => x.SB_PER_TEAM), backgroundColor: REP.season.map(x => (x.year === peak ? COLORS[1] : COLORS[0])) }] },
    options: { plugins: { legend: { display: false }, tooltip: tip("dec1") }, scales: { x: { ticks: { maxTicksLimit: 14 } } } },
  });
}

/* Shades 1973–2021, the years only the AL used the designated hitter */
const dhBand = {
  id: "dhBand",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x } } = chart;
    const labels = chart.data.labels, i0 = labels.indexOf(1973), i1 = labels.indexOf(2021);
    if (i0 < 0) return;
    const x0 = x.getPixelForValue(i0), x1 = x.getPixelForValue(i1 < 0 ? labels.length - 1 : i1);
    ctx.save(); ctx.fillStyle = "rgba(242,201,76,.16)"; ctx.fillRect(x0, a.top, x1 - x0, a.bottom - a.top);
    ctx.fillStyle = "#8a6d12"; ctx.font = "600 12px Libre Franklin, sans-serif"; ctx.fillText("DH in AL only", x0 + 6, a.top + 14); ctx.restore();
  },
};
function drawLeagues(v = "OPS") {
  const ys = years();
  const series = lg => ys.map(y => REP.league_season.find(x => x.year === y && x.league === lg)?.[v] ?? null);
  const kind = v === "OPS" ? "avg" : "pct";
  line("leagues", ys, [
    { label: "American League", data: series("AL"), borderColor: COLORS[1] },
    { label: "National League", data: series("NL"), borderColor: COLORS[2] },
  ], kind, { inline: [dhBand] });
}
function drawFranchises(v = "HR") {
  const top = [...REP.franchise].sort((a, b) => b[v] - a[v]).slice(0, 15);
  const kind = v === "HR" ? "int" : "pct";
  charts.franchises?.destroy();
  charts.franchises = new Chart(document.getElementById("c-franchises"), {
    type: "bar",
    data: { labels: top.map(x => x.franchise), datasets: [{ label: v === "HR" ? "Home runs" : "HR per PA", data: top.map(x => x[v]), backgroundColor: top.map((_, i) => (i === 0 ? COLORS[1] : COLORS[0])) }] },
    options: {
      indexAxis: "y", interaction: { mode: "nearest", intersect: true },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => fmt(c.parsed.x, kind) } } },
      scales: { x: kind === "pct" ? pctAxis : { ticks: { callback: v => compact(v) } } },
    },
  });
}
function drawPositions() {
  const rows = [...REP.position].sort((a, b) => b.OPS - a.OPS);
  charts.positions?.destroy();
  charts.positions = new Chart(document.getElementById("c-positions"), {
    type: "bar",
    data: { labels: rows.map(x => x.pos), datasets: [
      { label: "OBP", data: rows.map(x => x.OBP), backgroundColor: COLORS[0] },
      { label: "SLG", data: rows.map(x => x.SLG), backgroundColor: COLORS[3] },
    ] },
    options: { plugins: { tooltip: tip("avg") }, scales: { y: avgAxis } },
  });
}
function drawHands() {
  const bd = REP.bats_decade, order = ["Right", "Left", "Switch", "Unknown"];
  charts.hands?.destroy();
  charts.hands = new Chart(document.getElementById("c-hands"), {
    type: "bar",
    data: { labels: bd.decades, datasets: order.filter(k => bd.series[k]).map((k, i) => ({ label: k, data: bd.series[k], backgroundColor: [COLORS[0], COLORS[1], COLORS[3], "#b9c2bb"][i] })) },
    options: { plugins: { tooltip: tip("pct") }, scales: { x: { stacked: true }, y: { stacked: true, max: 1, ...pctAxis } } },
  });
}
function drawXbh(v = "both") {
  const x = REP.decade_xbh;
  const ds = [];
  if (v === "both") ds.push({ label: "Doubles per 600 PA", data: x.map(r => r["2B_PER_600"]), backgroundColor: COLORS[2] });
  ds.push({ label: "Triples per 600 PA", data: x.map(r => r["3B_PER_600"]), backgroundColor: COLORS[1] });
  charts.xbh?.destroy();
  charts.xbh = new Chart(document.getElementById("c-xbh"), { type: "bar", data: { labels: x.map(r => r.decade), datasets: ds }, options: { plugins: { tooltip: tip("dec2") } } });
}

const DRAW = { homers: drawHomers, average: drawAverage, leagues: drawLeagues, franchises: drawFranchises, xbh: drawXbh };
function drawAll() {
  drawStrikeouts(); drawHomers(); drawAverage(); drawTto(); drawSteals();
  drawLeagues(); drawFranchises(); drawPositions(); drawHands(); drawXbh();
}
function wireToggles() {
  document.querySelectorAll(".seg[data-chart]").forEach(seg => {
    seg.addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      seg.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      DRAW[seg.dataset.chart](b.dataset.v);
    });
  });
}

/* ---------------- table of contents + reading progress ---------------- */
function buildToc() {
  const toc = document.getElementById("toc");
  const sections = [...document.querySelectorAll(".finding, .methods")];
  sections.forEach(s => {
    const li = document.createElement("li");
    li.innerHTML = `<a href="#${s.id}">${s.querySelector("h2").textContent}</a>`;
    toc.appendChild(li);
  });
  const links = [...toc.querySelectorAll("a")];
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) links.forEach(a => a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id));
    });
  }, { rootMargin: "-40% 0px -55% 0px" });
  sections.forEach(s => io.observe(s));
}
const bar = document.getElementById("progress");
window.addEventListener("scroll", () => {
  const h = document.documentElement;
  bar.style.width = (h.scrollTop / (h.scrollHeight - h.clientHeight)) * 100 + "%";
}, { passive: true });
