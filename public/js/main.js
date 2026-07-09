'use strict';

import { rescale } from './util.js';
import { state } from './state.js';
import { navigate, apiPost } from './api.js';
import { updatePlayerRows, updateStartStopBtn, updateTimer, initRaceView } from './race-view.js';
import { refreshSettingsView, initSettingsView } from './settings-view.js';
import { refreshRosterView, initRosterView } from './roster-view.js';
import { initOverlays } from './overlays.js';
import { initWebSocket } from './ws.js';

// ── Nav bar wiring (was inline onclick handlers in the monolith) ─────────────
function initNav() {
  document.getElementById('nav-race').addEventListener('click',     () => navigate('RACE'));
  document.getElementById('nav-roster').addEventListener('click',   () => navigate('ROSTER'));
  document.getElementById('nav-settings').addEventListener('click', () => navigate('SETTINGS'));
}

// ── Keyboard shortcuts (restores the C++ Cmd+1/2/3 behaviour) ────────────────
// 1/2/3 → views, Space → start/stop, m → mock mode. Ignored while typing.
function initKeyboard() {
  window.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case '1': navigate('RACE');     break;
      case '2': navigate('ROSTER');   break;
      case '3': navigate('SETTINGS'); break;
      case ' ': {
        e.preventDefault();  // don't scroll / re-trigger the focused button
        const idle = state.raceState === 'RACE_STOPPED' || state.raceState === 'RACE_COMPLETE';
        apiPost('/api/command', { cmd: idle ? 'start' : 'stop' });
        break;
      }
      case 'm':
      case 'M': apiPost('/api/command', { cmd: 'mock' }); break;
    }
  });
}

// ── Viewport scaling ──────────────────────────────────────────────────────────
window.addEventListener('resize', rescale);
rescale();

// ── Wire all views ────────────────────────────────────────────────────────────
initNav();
initKeyboard();
initRaceView();
initSettingsView();
initRosterView();
initOverlays();

// ── Initial render ────────────────────────────────────────────────────────────
updatePlayerRows();
updateStartStopBtn();
updateTimer();
refreshSettingsView();
refreshRosterView();

// ── Connect to the server ─────────────────────────────────────────────────────
initWebSocket();
