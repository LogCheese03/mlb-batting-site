/* ------------------------------------------------------------------
   sound.js: tiny synthesized hover/click sounds and a "Take Me Out to
   the Ball Game" chorus (no audio files; the 1908 song is public domain).
   Both are off by default; labeled buttons in the nav bar turn them on.
   Shared by index.html and dashboard.html.
------------------------------------------------------------------- */
(function () {
  let ctx = null;
  let enabled = false;
  try { enabled = localStorage.getItem("mlbSound") === "on"; } catch (e) { /* private mode */ }

  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
  }

  function tick(freq = 660, dur = 0.04, type = "sine", vol = 0.04) {
    if (!enabled) return;
    try {
      ensureCtx();
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(vol, t0 + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* audio unavailable, fail silently */ }
  }

  function setEnabled(v) {
    enabled = v;
    try { localStorage.setItem("mlbSound", v ? "on" : "off"); } catch (e) { /* private mode */ }
  }

  window.SiteSound = {
    hover: () => tick(660, 0.035, "sine", 0.035),
    click: () => tick(880, 0.05, "triangle", 0.06),
    isEnabled: () => enabled,
  };

  const HOVER_SELECTOR = [
    "button", "a.cta", "a.cta-inline", ".chip", ".data-table th[data-k]",
    ".seg button", ".tile", ".checklist label", ".nav-links a",
  ].join(", ");

  /* ---- music: chorus of "Take Me Out to the Ball Game" (key of D, 3/4, quarter = 1 unit) ---- */
  const SONG = "D2 d|B A F|A3|E3|D2 d|B A F|A3-|A2 z|B ^A B|F G A|B2 G|E3|B2 B|B c d|e c B|A F E|" +
    "D2 d|B A F|A3|E2 E|D2 E|F G A|B3-|B B c|d3|d3|d c B|A ^G A|B3|c3|d3-|d z2";
  const BEAT = 0.42;                         // seconds per quarter note (about 143 bpm)
  const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const KEY_SHARPS = { F: 1, C: 1 };         // key of D: F and C are sharp

  function parseSong(text) {
    const notes = [];
    const re = /(\^?)([A-Ga-g]|z)(\d?)(-?)/g;
    let m;
    while ((m = re.exec(text.replace(/\|/g, " ")))) {
      const beats = m[3] ? +m[3] : 1;
      if (m[2] === "z") { notes.push({ rest: true, beats }); continue; }
      const upper = m[2].toUpperCase();
      let semis = 60 + STEPS[upper] + (m[2] === upper ? 0 : 12);   // ABC "C" is middle C (MIDI 60)
      semis += m[1] ? 1 : (KEY_SHARPS[upper] || 0);
      const freq = 440 * Math.pow(2, (semis - 69) / 12);
      const last = notes[notes.length - 1];
      if (last && last.tie && last.freq === freq) { last.beats += beats; last.tie = !!m[4]; continue; }
      notes.push({ freq, beats, tie: !!m[4] });
    }
    return notes;
  }

  let musicOn = false, musicTimer = null, musicNodes = [], musicBtn = null;

  function playChorus() {
    ensureCtx();
    const song = parseSong(SONG);
    let t = ctx.currentTime + 0.08;
    musicNodes = [];
    song.forEach(n => {
      const dur = n.beats * BEAT;
      if (!n.rest) {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(n.freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.09, t + 0.02);
        gain.gain.setValueAtTime(0.07, t + Math.max(0.03, dur - 0.12));
        gain.gain.linearRampToValueAtTime(0.0001, t + dur - 0.02);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t); osc.stop(t + dur);
        musicNodes.push(osc);
      }
      t += dur;
    });
    const total = t - ctx.currentTime;
    musicTimer = setTimeout(() => { if (musicOn) playChorus(); }, (total + 0.6) * 1000);  // loop
  }

  function setMusic(on) {
    musicOn = on;
    if (on) { try { playChorus(); } catch (e) { musicOn = false; } }
    else {
      clearTimeout(musicTimer);
      musicNodes.forEach(o => { try { o.stop(); } catch (e) { /* already stopped */ } });
      musicNodes = [];
    }
    if (musicBtn) {
      musicBtn.setAttribute("aria-pressed", String(musicOn));
      musicBtn.textContent = musicOn ? "\u23F9 Stop music" : "\u266A Play ballgame song";
    }
  }

  function makeButton(id, label, pressed) {
    const btn = document.createElement("button");
    btn.id = id; btn.type = "button"; btn.className = "sound-toggle";
    btn.setAttribute("aria-pressed", String(pressed));
    btn.textContent = label;
    return btn;
  }

  function buildToggle() {
    const nav = document.querySelector(".nav-inner");
    if (!nav || document.getElementById("soundToggle")) return;
    const box = document.createElement("div");
    box.className = "sound-controls";

    const fx = makeButton("soundToggle", "", enabled);
    const fxLabel = () => (fx.textContent = enabled ? "\uD83D\uDD0A Click sounds: on" : "\uD83D\uDD08 Click sounds: off");
    fx.title = "Turn hover and click sounds on or off";
    fxLabel();
    fx.addEventListener("click", () => {
      setEnabled(!enabled);
      fxLabel();
      fx.setAttribute("aria-pressed", String(enabled));
      if (enabled) tick(880, 0.06, "triangle", 0.08);
    });

    musicBtn = makeButton("musicToggle", "\u266A Play ballgame song", false);
    musicBtn.title = "Play Take Me Out to the Ball Game";
    musicBtn.addEventListener("click", () => setMusic(!musicOn));

    box.append(musicBtn, fx);
    nav.appendChild(box);
  }

  let lastHover = null;
  document.addEventListener("mouseover", e => {
    const el = e.target.closest(HOVER_SELECTOR);
    if (el && el !== lastHover) { lastHover = el; window.SiteSound.hover(); }
  });
  document.addEventListener("mouseout", e => {
    const el = e.target.closest(HOVER_SELECTOR);
    if (el && el === lastHover && !el.contains(e.relatedTarget)) lastHover = null;
  });
  document.addEventListener("click", e => {
    if (e.target.closest(HOVER_SELECTOR)) window.SiteSound.click();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", buildToggle);
  else buildToggle();
})();
