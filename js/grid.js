/* ------------------------------------------------------------------
   grid.js: the daily Grid game. Loads data/grid.json (criteria and the
   criteria each player meets), builds the same 3x3 grid for everyone on
   a given day from a date-seeded random generator, and checks guesses.
------------------------------------------------------------------- */
(function () {
  const $ = (id) => document.getElementById(id);
  const MIN_ANSWERS = 3;      // every square must have at least this many valid players
  const GUESSES = 9;
  let DATA = null;
  const mode = "all";   // one pool: hitters and pitchers together
  let day = todayStr();
  let puzzle = null, state = null, activeCell = -1;

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // ---------- seeded random numbers ----------
  function hashSeed(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; };
  }
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ---------- puzzle generation ----------
  function buildSets(kind) {
    const d = DATA[kind];
    if (d.sets) return d;
    d.sets = d.criteria.map(() => new Set());
    d.players.forEach((p, i) => p[5].forEach((c) => d.sets[c].add(i)));
    d.norm = d.players.map((p) => p[1].normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    return d;
  }

  function answersFor(d, a, b) {
    const [small, big] = d.sets[a].size < d.sets[b].size ? [a, b] : [b, a];
    const out = [];
    d.sets[small].forEach((i) => { if (d.sets[big].has(i)) out.push(i); });
    return out;
  }

  function makePuzzle(kind, dayStr) {
    const d = buildSets(kind);
    const rand = mulberry32(hashSeed(kind + "|" + dayStr)());
    const n = d.criteria.length;
    const pick = (k) => { const s = new Set(); while (s.size < k) s.add(Math.floor(rand() * n)); return [...s]; };
    let best = null;
    for (let attempt = 0; attempt < 20000; attempt++) {
      const six = pick(6), rows = six.slice(0, 3), cols = six.slice(3);
      const teams = six.filter((c) => d.criteria[c].type === "team").length;
      if (teams < 2 || teams > 4) continue;   // a mix: some teams, some stats or positions
      // Row and column criteria in one square must not overlap in meaning (e.g. 30+ HR and 40+ HR).
      let ok = true;
      for (const r of rows) for (const c of cols) {
        const gr = d.criteria[r], gc = d.criteria[c];
        if (gr.group === gc.group && gr.type !== "team") ok = false;
      }
      if (!ok) continue;
      const cells = [];
      for (const r of rows) for (const c of cols) {
        const ans = answersFor(d, r, c);
        if (ans.length < MIN_ANSWERS) { ok = false; break; }
        cells.push(ans);
      }
      if (!ok) continue;
      if (cells.reduce((s, a) => s + a.length, 0) / 9 > 120) continue;   // skip grids where every square is easy
      best = { kind, day: dayStr, rows, cols, cells };
      break;
    }
    return best;
  }

  // ---------- state ----------
  const key = () => "mlbGrid|" + mode + "|" + day;
  function loadState() {
    try { const s = JSON.parse(localStorage.getItem(key())); if (s && s.cells && s.cells.length === 9) return s; } catch (e) { /* ignore */ }
    return { cells: Array(9).fill(null), left: GUESSES, score: 0, used: [], misses: 0 };
  }
  function saveState() { try { localStorage.setItem(key(), JSON.stringify(state)); } catch (e) { /* ignore */ } }

  // ---------- drawing ----------
  const crit = (i) => DATA[mode].criteria[i];
  const cellsFull = () => state.cells.every(Boolean);
  const finished = () => state.left <= 0 || cellsFull();

  function draw() {
    const g = $("grid");
    const rows = puzzle.rows, cols = puzzle.cols;
    let h = '<div class="g-corner"></div>' + cols.map((c) => `<div class="g-head g-col">${esc(crit(c).label)}</div>`).join("");
    for (let r = 0; r < 3; r++) {
      h += `<div class="g-head g-row">${esc(crit(rows[r]).label)}</div>`;
      for (let c = 0; c < 3; c++) {
        const idx = r * 3 + c, cell = state.cells[idx];
        const label = `${crit(rows[r]).label} and ${crit(cols[c]).label}`;
        if (cell) h += `<div class="g-cell hit" role="gridcell"><span class="g-name">${esc(cell.name)}</span><span class="g-pts">${cell.pts} pts</span></div>`;
        else h += `<button class="g-cell${idx === activeCell ? " active" : ""}" data-i="${idx}" ${finished() ? "disabled" : ""} aria-label="${esc(label)}">${finished() ? "" : "+"}</button>`;
      }
    }
    g.innerHTML = h;
    $("left").textContent = state.left;
    $("score").textContent = state.score;
    g.querySelectorAll("button.g-cell").forEach((b) => b.addEventListener("click", () => openCell(+b.dataset.i)));
    $("done").hidden = !finished();
    if (finished()) showDone();
    $("pick").hidden = activeCell < 0 || finished();
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function say(t, bad) { const m = $("msg"); m.textContent = t; m.classList.toggle("bad", !!bad); }

  function openCell(i) {
    activeCell = i;
    const r = Math.floor(i / 3), c = i % 3;
    $("pickLabel").textContent = `${crit(puzzle.rows[r]).label}  ×  ${crit(puzzle.cols[c]).label}`;
    $("pickSearch").value = "";
    hideSuggest();
    draw();
    $("pickSearch").focus();
  }

  // ---------- search ----------
  let sugg = [], suggActive = -1;
  function hideSuggest() { $("pickSuggest").hidden = true; sugg = []; suggActive = -1; }
  function search() {
    const q = $("pickSearch").value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    if (q.length < 1) return hideSuggest();
    const d = DATA[mode], used = new Set(state.used);
    const hits = [];
    for (let i = 0; i < d.players.length; i++) {
      if (d.norm[i].includes(q) && !used.has(i)) hits.push(i);
    }
    // Names with a word starting with the typed text come first (so "ju" lists Judge before Beaujul), then the longest careers.
    const rank = (i) => (d.norm[i].startsWith(q) ? 0 : (" " + d.norm[i]).includes(" " + q) ? 1 : 2);
    hits.sort((a, b) => rank(a) - rank(b) || d.players[b][4] - d.players[a][4]);
    sugg = hits.slice(0, 10);
    const ul = $("pickSuggest");
    ul.innerHTML = sugg.map((i, k) => { const p = d.players[i];
      return `<li role="option" data-k="${k}">${esc(p[1])} <span class="muted">(${p[2]}–${p[3]})</span></li>`; }).join("") || '<li class="muted">No unused player by that name</li>';
    ul.hidden = false; suggActive = -1;
    ul.querySelectorAll("li[data-k]").forEach((li) => li.addEventListener("mousedown", (e) => { e.preventDefault(); guess(sugg[+li.dataset.k]); }));
  }

  // ---------- guessing ----------
  function guess(pi) {
    if (activeCell < 0 || finished()) return;
    const d = DATA[mode], p = d.players[pi], cell = puzzle.cells[activeCell];
    state.left--; state.used.push(pi);
    if (cell.includes(pi)) {
      // Points: share of the other valid answers with a longer career than this player.
      const longer = cell.filter((a) => d.players[a][4] > p[4]).length;
      const pts = Math.max(1, Math.round(100 * longer / cell.length));
      state.cells[activeCell] = { pid: p[0], name: p[1], pts };
      state.score += pts;
      say(`${p[1]} fits. +${pts} points.`);
    } else {
      state.misses++;
      say(`${p[1]} doesn't fit that square.`, true);
    }
    activeCell = -1;
    $("pickSearch").value = ""; hideSuggest();
    saveState(); draw();
  }

  function showDone() {
    const filled = state.cells.filter(Boolean).length;
    $("doneTitle").textContent = filled === 9 ? `Grid complete! ${state.score} points` : `Out of guesses: ${filled}/9 squares, ${state.score} points`;
    const rows = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (state.cells[r * 3 + c] ? "🟩" : "⬛")).join("")).join("\n");
        $("shareText").textContent = `MLB Daily Grid ${day}\n${rows}\n${filled}/9 · ${state.score} pts\n${location.origin}${location.pathname}`;
    const d = DATA[mode];
    const missed = state.cells.map((c, i) => c ? null : i).filter((i) => i !== null);
    $("reveal").innerHTML = missed.length ? "<h3>Squares you missed</h3><ul>" + missed.map((i) => {
      const r = Math.floor(i / 3), c = i % 3;
      const top = puzzle.cells[i].slice().sort((a, b) => d.players[b][4] - d.players[a][4]).slice(0, 3).map((a) => d.players[a][1]).join(", ");
      return `<li><b>${esc(crit(puzzle.rows[r]).label)} × ${esc(crit(puzzle.cols[c]).label)}</b>: ${esc(top)} (${puzzle.cells[i].length} valid)</li>`;
    }).join("") + "</ul>" : "";
  }

  // ---------- setup ----------
  function start() {
    puzzle = makePuzzle(mode, day);
    if (!puzzle) { $("grid").innerHTML = ""; say("Could not build a grid for that day.", true); return; }
    state = loadState(); activeCell = -1;
    say(finished() ? "You already played this grid." : "Click a square to start.");
    draw();
  }

  function init() {
    $("dayPick").value = day; $("dayPick").max = todayStr(); $("dayPick").min = "2026-09-27";
    $("dayPick").addEventListener("change", (e) => { if (e.target.value) { day = e.target.value; start(); } });
    const inp = $("pickSearch");
    inp.addEventListener("input", search);
    inp.addEventListener("keydown", (e) => {
      const lis = $("pickSuggest").querySelectorAll("li[data-k]");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!lis.length) return;
        suggActive = (suggActive + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, k) => li.classList.toggle("active", k === suggActive));
      } else if (e.key === "Enter") { e.preventDefault(); const k = suggActive >= 0 ? suggActive : 0; if (sugg[k] !== undefined) guess(sugg[k]); }
      else if (e.key === "Escape") { activeCell = -1; hideSuggest(); draw(); }
    });
    inp.addEventListener("blur", () => setTimeout(hideSuggest, 120));
    $("pickCancel").addEventListener("click", () => { activeCell = -1; hideSuggest(); draw(); });
    $("shareBtn").addEventListener("click", () => {
      const t = $("shareText").textContent;
      (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => { $("shareBtn").textContent = "Copied!"; setTimeout(() => $("shareBtn").textContent = "Copy result", 1500); }, () => say("Copy failed. Select the text and copy it by hand.", true));
    });
    start();
    $("loading").hidden = true;
  }

  fetch("data/grid.json").then((r) => r.json()).then((j) => { DATA = j; init(); })
    .catch(() => { $("loading").textContent = "Could not load the grid data."; });
})();
