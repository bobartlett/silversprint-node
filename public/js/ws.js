'use strict';

import { state, applyModel } from './state.js';
import { setActiveView, updateStartStopBtn, updateTimer, scheduleRender } from './race-view.js';
import { showCountdown, showWinnerModal } from './overlays.js';
import { refreshRosterView } from './roster-view.js';
import { updateConnectionStatus, updatePortDropdown } from './settings-view.js';

// ── Central WS message dispatcher ────────────────────────────────────────────
function dispatch(msg) {
  switch (msg.type) {

    case 'full_state':
      applyModel(msg.data);
      setActiveView(msg.appState  || 'RACE');
      state.raceState = msg.raceState || 'RACE_STOPPED';
      updateStartStopBtn();
      if (msg.appVersion) {
        document.getElementById('app-version').textContent = 'SILVERSPRINT VERSION: ' + msg.appVersion;
      }
      break;

    case 'race_update':
      state.elapsedRaceTimeMillis = msg.data.elapsedRaceTimeMillis;
      msg.data.players.forEach((p, i) => Object.assign(state.players[i], p));
      scheduleRender();  // drawRings() runs inside updateRaceTick()
      break;

    case 'race_state':
      state.raceState = msg.state;
      updateStartStopBtn();
      showCountdown(msg.state);
      if (msg.state === 'RACE_STOPPED' || msg.state === 'RACE_COMPLETE') {
        updateTimer();
      }
      if (msg.state === 'RACE_COMPLETE') {
        showWinnerModal(true);
      }
      if (msg.state === 'RACE_STOPPED') {
        showWinnerModal(false);
      }
      break;

    case 'app_state':
      setActiveView(msg.state);
      break;

    case 'settings_updated':
      applyModel(msg.data);
      break;

    case 'roster_updated':
      msg.players.forEach((p, i) => { state.players[i].name = p.name; });
      scheduleRender();
      refreshRosterView();
      break;

    case 'racer_finished':
      state.players[msg.racerId].finished        = true;
      state.players[msg.racerId].finishTimeMillis = msg.timeMillis;
      scheduleRender();
      break;

    case 'race_finished':
      applyModel(msg.data);
      break;

    case 'arduino_connected':
      state.serialConnectionState = 'CONNECTED_UNKNOWN';
      updateConnectionStatus();
      break;

    case 'arduino_disconnected':
      state.serialConnectionState = 'DISCONNECTED';
      updateConnectionStatus();
      break;

    case 'arduino_identified':
      state.serialConnectionState = msg.connectionState;
      state.firmwareVersion        = msg.version;
      updateConnectionStatus();
      break;

    case 'port_list': {
      // Rebuilding a <select> collapses it if the user has it open, and resets
      // scroll — only rebuild when the list actually changed and it isn't focused.
      const changed = JSON.stringify(msg.ports) !== JSON.stringify(state.serialDeviceList);
      state.serialDeviceList = msg.ports;
      const sel = document.getElementById('s-port');
      if (changed && document.activeElement !== sel) updatePortDropdown();
      break;
    }

    case 'false_start': {
      // Briefly flash the offending racer's row red.
      const bg = document.getElementById(`row-bg-${msg.racerId}`);
      if (bg) {
        bg.classList.remove('false-start');
        void bg.offsetWidth;  // force reflow so the animation restarts
        bg.classList.add('false-start');
        bg.addEventListener('animationend', () => bg.classList.remove('false-start'), { once: true });
      }
      console.log('[UI] False start: racer', msg.racerId);
      break;
    }

    case 'mock_mode':
      document.getElementById('mock-badge').style.display = msg.on ? '' : 'none';
      break;

    case 'start_failed': {
      // Server watchdog gave up waiting for the Arduino's countdown.
      const banner = document.getElementById('warn-banner');
      banner.textContent = 'START FAILED — CHECK ARDUINO CONNECTION';
      banner.classList.remove('hidden');
      clearTimeout(banner._hideTimer);
      banner._hideTimer = setTimeout(() => banner.classList.add('hidden'), 6000);
      break;
    }

    default:
      // ignore unknown messages
  }
}

// ── WebSocket manager with auto-reconnect ────────────────────────────────────
export function initWebSocket() {
  let _ws            = null;
  let _reconnectMs   = 1000;
  const MAX_DELAY_MS = 10000;

  function connect() {
    _ws = new WebSocket(`ws://${location.host}`);

    _ws.onopen = () => {
      console.log('[WS] Connected');
      _reconnectMs = 1000;
    };

    _ws.onclose = () => {
      console.log(`[WS] Disconnected — reconnecting in ${_reconnectMs}ms`);
      setTimeout(connect, _reconnectMs);
      _reconnectMs = Math.min(_reconnectMs * 1.5, MAX_DELAY_MS);
    };

    _ws.onmessage = ({ data }) => {
      try { dispatch(JSON.parse(data)); }
      catch (e) { console.error('[WS] Parse error', e); }
    };

    _ws.onerror = () => { /* onclose will fire next */ };
  }

  connect();
}
