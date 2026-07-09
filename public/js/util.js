'use strict';

// ── Utility ───────────────────────────────────────────────────────────────────
export function millisToTimestamp(ms) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const c = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(c).padStart(2,'0')}`;
}

// ── Viewport scaling (mirrors C++ getCenteredFit logic) ───────────────────────
export function rescale() {
  const scaleX = window.innerWidth  / 1920;
  const scaleY = window.innerHeight / 1080;
  const scale  = Math.min(scaleX, scaleY);
  const offX   = (window.innerWidth  - 1920 * scale) / 2;
  const offY   = (window.innerHeight - 1080 * scale) / 2;
  document.getElementById('app').style.transform =
    `translate(${offX}px, ${offY}px) scale(${scale})`;
}
