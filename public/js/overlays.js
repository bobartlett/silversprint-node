'use strict';

import { state } from './state.js';
import { apiPost } from './api.js';
import { millisToTimestamp } from './util.js';

// ── Countdown overlay — Phase 4e ─────────────────────────────────────────────
// Animation mirrors CountDownGfx.cpp: scale 0→1 (pop-in), hold, scale 1→2 + fade.
// Each number runs a 1s CSS @keyframes cd-pop animation, then the overlay hides.

const CD_MAP = {
  RACE_COUNTDOWN_3:  'cd-3',
  RACE_COUNTDOWN_2:  'cd-2',
  RACE_COUNTDOWN_1:  'cd-1',
  RACE_COUNTDOWN_GO: 'cd-go',
};

export function showCountdown(raceState) {
  const overlay = document.getElementById('overlay-countdown');
  const imgId   = CD_MAP[raceState];

  if (!imgId) {
    // RACE_RUNNING arrives immediately after RACE_COUNTDOWN_GO (the server
    // double-emits). Hiding now would kill the GO animation before it shows,
    // so leave the overlay alone — the GO hide-timer will clear it in 1s.
    if (raceState !== 'RACE_RUNNING') {
      clearTimeout(overlay._hideTimer);
      overlay.classList.add('hidden');   // STOPPED / COMPLETE: hide immediately
    }
    return;
  }

  // A pending GO hide-timer from the previous race would blank this countdown.
  clearTimeout(overlay._hideTimer);
  overlay.classList.remove('hidden');

  // display:none cancels CSS animations but leaves the class behind, so any
  // image still marked .animating from the last race would replay its pop the
  // instant the overlay reappears (GO showing before 3). Clear all of them.
  overlay.querySelectorAll('.cd-image').forEach(el => el.classList.remove('animating'));

  const img = document.getElementById(imgId);
  void img.offsetWidth;  // force reflow to reset animation
  img.classList.add('animating');

  // After 1s the animation ends; hide overlay on the last step (GO)
  if (raceState === 'RACE_COUNTDOWN_GO') {
    clearTimeout(overlay._hideTimer);
    overlay._hideTimer = setTimeout(() => overlay.classList.add('hidden'), 1000);
  }
}

// ── Winner modal — Phase 4e ───────────────────────────────────────────────────
// Populates winner name, race metric, top speed, and runner-up boxes.
// Sorting mirrors WinnerModal::getWinners():
//   distance race → by finishTimeMillis asc, time race → by ticks desc.

function populateWinnerModal() {
  const racers = state.players.slice(0, state.numRacers);

  let sorted;
  if (state.raceType === 'DISTANCE') {
    sorted = [...racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTimeMillis - b.finishTimeMillis;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.ticks - a.ticks;
    });
  } else {
    sorted = [...racers].sort((a, b) => b.ticks - a.ticks);
  }

  const winner  = sorted[0];
  const runners = sorted.slice(1);

  // Winner name (centered at x≈550 within modal)
  document.getElementById('wc-name').textContent =
    (winner.name || 'RACER').toUpperCase();

  // Race metric label + value + speed
  if (state.raceType === 'DISTANCE') {
    document.getElementById('wc-label').textContent  = 'TIME';
    document.getElementById('wc-metric').textContent = winner.finished
      ? millisToTimestamp(winner.finishTimeMillis)
      : 'DNF';
  } else {
    document.getElementById('wc-label').textContent  = 'DISTANCE';
    document.getElementById('wc-metric').textContent = state.useKph
      ? `${winner.distanceMeters.toFixed(2)}m`
      : `${winner.distanceFeet.toFixed(2)}ft`;
  }
  document.getElementById('wc-speed').textContent = state.useKph
    ? `${winner.maxKph.toFixed(1)}kph`
    : `${winner.maxMph.toFixed(1)}mph`;

  // Runner-up boxes (mirrors the secondary-racer loop in WinnerModal::draw())
  const container = document.getElementById('wc-runners');
  container.innerHTML = '';
  const NR  = runners.length;
  const GAP = 24;
  const BOX = 360;
  const totalW = BOX * NR + GAP * Math.max(0, NR - 1);

  // Build boxes with DOM nodes + textContent — player names are user input and
  // must never be interpolated into an HTML string.
  const mkDiv = (css, text) => {
    const d = document.createElement('div');
    d.style.cssText = css;
    if (text !== undefined) d.textContent = text;
    return d;
  };

  runners.forEach((p, i) => {
    const lm      = -totalW * 0.5 + (BOX + GAP) * i;
    const offsetX = lm + 1127 * 0.5;    // center within modal width

    let metric;
    if (state.raceType === 'DISTANCE') {
      metric = p.finished ? millisToTimestamp(p.finishTimeMillis) : 'DNF';
    } else {
      metric = state.useKph ? `${p.distanceMeters.toFixed(2)}m` : `${p.distanceFeet.toFixed(2)}ft`;
    }

    const speed = state.useKph
      ? `${p.maxKph.toFixed(1)}kph`
      : `${p.maxMph.toFixed(1)}mph`;

    const name = (p.name || `RACER ${i + 2}`).toUpperCase();

    // Each box: 360×100px colored background, black divider, grey footer bar
    const box = mkDiv(`position:absolute;left:${offsetX}px;top:0;width:360px;font-family:'UbuntuMono',monospace;`);
    box.appendChild(mkDiv(`position:absolute;top:0;left:0;width:360px;height:100px;background:${p.color};`));
    box.appendChild(mkDiv('position:absolute;left:193px;top:60px;width:4px;height:28px;background:#000;'));
    box.appendChild(mkDiv('position:absolute;top:110px;left:0;width:360px;height:4px;background:#e5e5e5;'));
    box.appendChild(mkDiv('position:absolute;left:20px;top:7px;font-size:35px;color:#fff;', name));
    box.appendChild(mkDiv('position:absolute;left:20px;top:47px;font-size:35px;color:#fff;', metric));
    box.appendChild(mkDiv('position:absolute;left:210px;top:47px;font-size:35px;color:#fff;', speed));
    container.appendChild(box);
  });
}

export function showWinnerModal(show) {
  const overlay = document.getElementById('overlay-winner');
  if (show) {
    populateWinnerModal();
    overlay.classList.remove('hidden');
    overlay.classList.add('interactive');
    requestAnimationFrame(() => overlay.classList.add('show'));
  } else {
    overlay.classList.remove('show', 'interactive');
    setTimeout(() => overlay.classList.add('hidden'), 1000);
  }
}

// Wire the winner-modal dismiss click (was an inline listener in the monolith).
export function initOverlays() {
  document.getElementById('overlay-winner').addEventListener('click', () => {
    apiPost('/api/command', { cmd: 'stop' });
    showWinnerModal(false);
  });
}
