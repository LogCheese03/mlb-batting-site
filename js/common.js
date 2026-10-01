/* ------------------------------------------------------------------
   common.js: shared by index.html and dashboard.html
   The formulas here MUST match scripts/prep_data.py so both pages agree.
------------------------------------------------------------------- */

const COLORS = ["#0b2545", "#c8102e", "#2f6db5", "#8da2c0", "#e57a86", "#1f8a8a", "#7a0f22", "#6fa8e0", "#4a5568", "#e0a526"];

/* Bump this whenever data/batting.csv or data/report.json changes, so
   returning visitors' browsers fetch the new file instead of serving
   their cached copy for the rest of its 10-minute Cache-Control window. */
const DATA_VERSION = "2026season-p14";

const SUM_COLS = ["G", "PA", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "CS", "BB", "SO", "HBP", "SH", "SF"];

/* An accumulator of totals for any group of rows */
function emptyTotals() {
  const t = { rows: 0, hrList: [], paList: [] };
  SUM_COLS.forEach(c => (t[c] = 0));
  return t;
}
function addRow(t, row) {
  t.rows += 1;
  for (const c of SUM_COLS) t[c] += row[c];
  t.hrList.push(row.HR);
  t.paList.push(row.PA);
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const safeDiv = (a, b) => (b ? a / b : null);
const TB = t => t.H + t["2B"] + 2 * t["3B"] + 3 * t.HR;
const OBP = t => safeDiv(t.H + t.BB + t.HBP, t.AB + t.BB + t.HBP + t.SF);
const SLG = t => safeDiv(TB(t), t.AB);

/* Every measure the dashboard can show. kind controls formatting. */
const MEASURES = {
  rows:    { label: "Player-seasons (count)", kind: "int", fn: t => t.rows },
  PA:      { label: "Plate appearances (total)", kind: "int", fn: t => t.PA },
  HR:      { label: "Home runs (total)", kind: "int", fn: t => t.HR },
  "2B":    { label: "Doubles (total)", kind: "int", fn: t => t["2B"] },
  "3B":    { label: "Triples (total)", kind: "int", fn: t => t["3B"] },
  H:       { label: "Hits (total)", kind: "int", fn: t => t.H },
  R:       { label: "Runs (total)", kind: "int", fn: t => t.R },
  RBI:     { label: "RBI (total)", kind: "int", fn: t => t.RBI },
  G:       { label: "Games (total)", kind: "int", fn: t => t.G },
  TB:      { label: "Total bases (total)", kind: "int", fn: t => TB(t) },
  XBH:     { label: "Extra-base hits (2B + 3B + HR)", kind: "int", fn: t => t["2B"] + t["3B"] + t.HR },
  SB:      { label: "Stolen bases (total)", kind: "int", fn: t => t.SB },
  BB:      { label: "Walks (total)", kind: "int", fn: t => t.BB },
  SO:      { label: "Strikeouts (total)", kind: "int", fn: t => t.SO },
  medHR:   { label: "Home runs per player-season (median)", kind: "dec1", fn: t => median(t.hrList) },
  medPA:   { label: "Plate appearances per player-season (median)", kind: "dec1", fn: t => median(t.paList) },
  BA:      { label: "Batting average (H / AB)", kind: "avg", rate: true, fn: t => safeDiv(t.H, t.AB) },
  OBP:     { label: "On-base percentage", kind: "avg", rate: true, fn: OBP },
  SLG:     { label: "Slugging percentage", kind: "avg", rate: true, fn: SLG },
  OPS:     { label: "OPS (OBP + SLG)", kind: "avg", rate: true, fn: t => { const o = OBP(t), s = SLG(t); return o == null || s == null ? null : o + s; } },
  K_PCT:   { label: "Strikeout rate (SO / PA)", kind: "pct", rate: true, fn: t => safeDiv(t.SO, t.PA) },
  BB_PCT:  { label: "Walk rate (BB / PA)", kind: "pct", rate: true, fn: t => safeDiv(t.BB, t.PA) },
  HR_PCT:  { label: "Home run rate (HR / PA)", kind: "pct", rate: true, fn: t => safeDiv(t.HR, t.PA) },
  TTO_PCT: { label: "Three true outcomes rate ((HR+BB+SO) / PA)", kind: "pct", rate: true, fn: t => safeDiv(t.HR + t.BB + t.SO, t.PA) },
  ISO:     { label: "Isolated power (SLG − AVG)", kind: "avg", rate: true, fn: t => { const sl = SLG(t), ba = safeDiv(t.H, t.AB); return sl == null || ba == null ? null : sl - ba; } },
  BABIP:   { label: "BABIP ((H − HR) / (AB − SO − HR + SF))", kind: "avg", rate: true, fn: t => safeDiv(t.H - t.HR, t.AB - t.SO - t.HR + t.SF) },
  SB_PCT:  { label: "Stolen base success rate (SB / (SB + CS))", kind: "pct", rate: true, fn: t => safeDiv(t.SB, t.SB + t.CS) },
  BB_K:    { label: "Walk-to-strikeout ratio (BB / SO)", kind: "dec2", rate: true, fn: t => safeDiv(t.BB, t.SO) },
};

/* ---------------- formatting ---------------- */
const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmt(v, kind) {
  if (v == null || Number.isNaN(v)) return "–";
  switch (kind) {
    case "int": return nf0.format(v);
    case "dec1": return nf1.format(v);
    case "dec2": return v.toFixed(2);
    case "pct": return (v * 100).toFixed(1) + "%";
    case "avg": { const s = v.toFixed(3); return v < 1 ? s.replace(/^0/, "") : s; } // baseball style .263
    default: return String(v);
  }
}
const compact = v => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);

/* ---------------- Chart.js theme ---------------- */
function applyChartTheme() {
  if (!window.Chart) return;
  Chart.defaults.font.family = '"Libre Franklin", "Helvetica Neue", Arial, sans-serif';
  Chart.defaults.font.size = 12.5;
  Chart.defaults.color = "#5b6573";
  Chart.defaults.borderColor = "#e3e8e1";
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.tooltip.backgroundColor = "#0b2545";
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.titleFont = { weight: "700" };
  Chart.defaults.elements.line.borderWidth = 2.5;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.interaction = { mode: "index", intersect: false };
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) Chart.defaults.animation = false;
}

/* Save a chart as PNG */
function downloadChart(chart, name) {
  const a = document.createElement("a");
  a.href = chart.toBase64Image("image/png", 1);
  a.download = name + ".png";
  a.click();
}

/* Save rows as CSV */
function downloadCSV(rows, name) {
  const esc = v => (typeof v === "string" && /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v ?? "");
  const csv = rows.map(r => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = name + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* Runs fn once el is within `margin` of the viewport (or right away if the browser cannot tell).
   Used to download the two large team tables on the report only when a reader scrolls near them. */
function whenNearViewport(el, fn, margin = "800px") {
  if (!el || !("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { rootMargin: margin });
  io.observe(el);
}
