'use strict';

import { state } from './state.js';
import { apiPost } from './api.js';
import { millisToTimestamp } from './util.js';
import { drawRings } from './rings.js';

// ── View router ───────────────────────────────────────────────────────────────
export function setActiveView(appState) {
  state.appState = appState;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-icon').forEach(n => n.classList.remove('active'));

  const viewMap = { RACE: 'view-race', ROSTER: 'view-roster', SETTINGS: 'view-settings' };
  const navMap  = { RACE: 'nav-race',  ROSTER: 'nav-roster',  SETTINGS: 'nav-settings' };

  document.getElementById(viewMap[appState])?.classList.add('active');
  document.getElementById(navMap[appState])?.classList.add('active');
}

// ── Race state → Start/Stop button label + colour ─────────────────────────────
export function updateStartStopBtn() {
  const btn   = document.getElementById('start-stop-btn');
  const s     = state.raceState;
  const idle  = (s === 'RACE_STOPPED' || s === 'RACE_COMPLETE');
  btn.textContent = idle ? 'START' : 'STOP';
  btn.classList.toggle('running', !idle);
}

// ── Timer display ─────────────────────────────────────────────────────────────
export function updateTimer() {
  const s   = state.raceState;
  const el  = document.getElementById('timer-display');
  if (s === 'RACE_RUNNING') {
    if (state.raceType === 'DISTANCE') {
      el.textContent = millisToTimestamp(state.elapsedRaceTimeMillis);
    } else {
      const remaining = Math.max(0, state.raceLengthMillis - state.elapsedRaceTimeMillis);
      el.textContent = millisToTimestamp(remaining);
    }
  } else if (s === 'RACE_COMPLETE') {
    el.textContent = state.raceType === 'DISTANCE'
      ? millisToTimestamp(state.elapsedRaceTimeMillis)
      : millisToTimestamp(0);
  } else {
    el.textContent = millisToTimestamp(0);
  }
}

// ── Player row visibility + colours ──────────────────────────────────────────
export function updatePlayerRows() {
  for (let i = 0; i < 4; i++) {
    const row = document.querySelector(`.player-row[data-racer="${i}"]`);
    row.style.display = i < state.numRacers ? 'block' : 'none';
  }
}

// Coalesce bursts of WebSocket updates into a single render per animation frame,
// so ~30Hz race_update messages don't each trigger a full DOM + canvas repaint.
let _renderQueued = false;
export function scheduleRender() {
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => { _renderQueued = false; updateRaceTick(); });
}

// ── Race tick update (high-frequency — called on every race_update) ───────────
export function updateRaceTick() {
  for (let i = 0; i < state.numRacers; i++) {
    const p = state.players[i];

    // Name
    document.getElementById(`pname-${i}`).textContent =
      (p.name || `Racer ${i + 1}`).toUpperCase();

    // Speed
    const spd = state.useKph
      ? `${p.kph.toFixed(1)} KPH`
      : `${p.mph.toFixed(1)} MPH`;
    document.getElementById(`pspeed-${i}`).textContent = spd;

    // Metric: finish time (distance race) or current distance (time race)
    let metric;
    if (state.raceType === 'DISTANCE') {
      metric = p.finished
        ? millisToTimestamp(p.finishTimeMillis)
        : millisToTimestamp(state.elapsedRaceTimeMillis);
    } else {
      metric = state.useKph
        ? `${p.distanceMeters.toFixed(2)}m`
        : `${p.distanceFeet.toFixed(2)}ft`;
    }
    document.getElementById(`pmetric-${i}`).textContent = metric;

    // Row background: solid fill when finished, inset border when racing
    // Mirrors RaceText::draw() — Rectf borders vs full fill
    const bg  = document.getElementById(`row-bg-${i}`);
    const div = document.getElementById(`row-div-${i}`);
    if (p.finished) {
      bg.style.background = p.color;
      bg.style.boxShadow  = '';
      div.style.background = '#000';
    } else {
      bg.style.background = 'transparent';
      bg.style.boxShadow  = `inset 0 0 0 7px ${p.color}`;
      div.style.background = p.color;
    }
  }

  updateTimer();
  drawRings();
}

// Wire the Start/Stop button (was an inline listener in the monolith).
export function initRaceView() {
  document.getElementById('start-stop-btn').addEventListener('click', () => {
    const idle = (state.raceState === 'RACE_STOPPED' || state.raceState === 'RACE_COMPLETE');
    apiPost('/api/command', { cmd: idle ? 'start' : 'stop' });
  });
}
