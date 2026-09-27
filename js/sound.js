/* ------------------------------------------------------------------
   sound.js: tiny synthesized hover/click sounds (no audio files).
   Off by default; a toggle button in the nav bar turns it on and
   remembers the choice. Shared by index.html and dashboard.html.
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

  function buildToggle() {
    const nav = document.querySelector(".nav-inner");
    if (!nav || document.getElementById("soundToggle")) return;
    const btn = document.createElement("button");
    btn.id = "soundToggle";
    btn.type = "button";
    btn.className = "sound-toggle";
    btn.title = "Toggle hover sounds";
    btn.setAttribute("aria-pressed", String(enabled));
    btn.textContent = enabled ? "🔊" : "🔈";
    btn.addEventListener("click", () => {
      setEnabled(!enabled);
      btn.textContent = enabled ? "🔊" : "🔈";
      btn.setAttribute("aria-pressed", String(enabled));
      if (enabled) tick(880, 0.06, "triangle", 0.08);
    });
    nav.appendChild(btn);
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
