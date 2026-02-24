'use strict';
const express = require('express');
const http    = require('http');
const { WebSocketServer } = require('ws');
const path    = require('path');

const { stateManager, APP_STATE, RACE_STATE } = require('./src/StateManager');
const { SerialReader }    = require('./src/SerialReader');
const { model }           = require('./src/Model');
const { config }          = require('./src/Config');
const { csvLogger, SS_EVENT } = require('./src/CsvLogger');
const { millisToTimestamp }   = require('./src/utils');

// ── Boot: load config and apply to model ─────────────────────────────────────

config.read();
_applyConfigToModel();
csvLogger.setHeaders(['Timestamp', 'Event', 'Racer1', 'Racer2', 'Racer3', 'Racer4']);

function _applyConfigToModel() {
  model.setRollerDiameterMm(config.get('roller_diameter_mm', 114.3));
  model.numRacers        = config.get('num_racers', 2);
  model.raceType         = config.get('race_type', 0) === 0 ? 'DISTANCE' : 'TIME';
  model.raceLengthMillis = config.get('race_time', 60) * 1000;
  model.useKph           = config.get('race_kph', true);
  model.logRaces         = config.get('log_races', false);
  // setRaceLengthMeters must be called AFTER setRollerDiameterMm (mirrors C++ setup order)
  model.setRaceLengthMeters(config.get('race_length_meters', 100));
}

// Mirrors SilverSprintApp::writeSettings()
function _saveConfig() {
  config.set('race_type',          model.raceType === 'DISTANCE' ? 0 : 1);
  config.set('race_length_meters', model.raceLengthMeters);
  config.set('race_time',          Math.round(model.raceLengthMillis / 1000));
  config.set('race_kph',           model.useKph);
  config.set('roller_diameter_mm', model.rollerDiameterMm);
  config.set('num_racers',         model.numRacers);
  config.set('log_races',          model.logRaces);
  config.write();
}

// ── Serial ───────────────────────────────────────────────────────────────────

const serial = new SerialReader(stateManager);

// ── HTTP + WebSocket ─────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function broadcast(msg) {
  const str = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) client.send(str);
  }
}

// Send a full snapshot to each browser immediately on connect.
wss.on('connection', ws => {
  console.log('[WS] Browser connected');
  ws.send(JSON.stringify({
    type:      'full_state',
    data:      model.toJSON(),
    appState:  stateManager.appState,
    raceState: stateManager.raceState,
  }));
});

// ── REST API ─────────────────────────────────────────────────────────────────

// POST /api/command  { cmd: 'start' | 'stop' | 'mock' }
// Triggers state machine transitions — the actual serial commands flow from
// the raceStateChange handler below, not from here.
// This mirrors the pattern in GFXMain::onKeyDown / GFXMain::onRaceStateChanged.
app.post('/api/command', (req, res) => {
  const { cmd } = req.body;

  switch (cmd) {
    case 'start':
      if (stateManager.raceState === RACE_STATE.STOPPED ||
          stateManager.raceState === RACE_STATE.COMPLETE) {
        stateManager.changeRaceState(RACE_STATE.STARTING);
      }
      break;

    case 'stop':
      if (stateManager.raceState !== RACE_STATE.STOPPED) {
        stateManager.changeRaceState(RACE_STATE.STOPPED);
      }
      break;

    case 'mock':
      serial.toggleMockMode();
      break;

    default:
      return res.status(400).json({ error: `Unknown command: ${cmd}` });
  }

  res.json({ ok: true });
});

// POST /api/navigate  { state: 'RACE' | 'ROSTER' | 'SETTINGS' }
// Switches the active view in the browser.
// Mirrors Cmd+1/2/3 keyboard shortcuts in SilverSprintsApp::keyDown().
app.post('/api/navigate', (req, res) => {
  const { state } = req.body;
  if (!Object.values(APP_STATE).includes(state)) {
    return res.status(400).json({ error: `Invalid app state: ${state}` });
  }
  stateManager.changeAppState(state);
  res.json({ ok: true });
});

// POST /api/roster  { players: [{ name: 'Alice' }, { name: 'Bob' }, ...] }
// Updates player names for the current session (not persisted — matches C++ behaviour).
app.post('/api/roster', (req, res) => {
  const { players } = req.body;
  if (!Array.isArray(players)) {
    return res.status(400).json({ error: 'players must be an array' });
  }
  players.forEach((p, i) => {
    if (i < 4 && p.name !== undefined) {
      model.playerData[i].playerName = String(p.name).trim();
    }
  });
  const roster = model.playerData.map(p => ({ name: p.playerName, color: p.playerColor }));
  broadcast({ type: 'roster_updated', players: roster });
  res.json({ ok: true });
});

// POST /api/settings  (partial — only keys present in the body are changed)
app.post('/api/settings', (req, res) => {
  const s = req.body;

  if (s.roller_diameter_mm != null) {
    model.setRollerDiameterMm(s.roller_diameter_mm);
    // C++ setRollerDiameterMm does NOT recalculate ticks; must call setRaceLengthMeters after.
    model.setRaceLengthMeters(model.raceLengthMeters);
  }
  if (s.num_racers         != null) model.numRacers = s.num_racers;
  if (s.race_type          != null) model.raceType  = s.race_type === 0 ? 'DISTANCE' : 'TIME';
  if (s.race_length_meters != null) model.setRaceLengthMeters(s.race_length_meters);
  if (s.race_time          != null) model.raceLengthMillis = s.race_time * 1000;
  if (s.race_kph           != null) model.useKph    = s.race_kph;
  if (s.log_races          != null) model.logRaces  = s.log_races;
  if (s.fullscreen         != null) config.setAppSetting('fullscreen', s.fullscreen);

  if (s.port != null) serial.selectDevice(s.port);

  _saveConfig();
  broadcast({ type: 'settings_updated', data: model.toJSON() });
  res.json({ ok: true });
});

// GET /api/state  — useful for debugging / curl
app.get('/api/state', (req, res) => {
  res.json({
    data:      model.toJSON(),
    appState:  stateManager.appState,
    raceState: stateManager.raceState,
  });
});

// ── CSV logging helper ────────────────────────────────────────────────────────

// Mirrors GFXMain::onRaceFinished() logging logic exactly:
// distance races → log finish timestamps, time races → log distances.
function _logRaceFinish() {
  if (!model.logRaces) return;

  if (model.raceType === 'DISTANCE') {
    const times = model.playerData.map(p =>
      p.isFinished() ? millisToTimestamp(p.finishTimeMillis) : ''
    );
    csvLogger.log(SS_EVENT.RACE_FINISH_DISTANCE, ...times);
  } else {
    const dists = model.playerData.map(p =>
      model.useKph ? p.getDistanceMeters().toFixed(2) : p.getDistanceFeet().toFixed(2)
    );
    csvLogger.log(SS_EVENT.RACE_FINISH_TIME, ...dists);
  }

  csvLogger.write();
}

// ── State machine → serial command wiring ────────────────────────────────────
//
// This is the Node.js equivalent of GFXMain::onRaceStateChanged().
// ALL serial commands are driven from here so that both the browser's
// Start button (via /api/command → state change) and the Arduino's own
// kiosk G button (via SerialReader → state change) go through identical code.

stateManager.on('raceStateChange', newState => {
  broadcast({ type: 'race_state', state: newState });

  // ── STARTING: configure Arduino and fire the start command ───────────────
  if (newState === RACE_STATE.STARTING) {
    model.resetPlayers();
    if (model.raceType === 'DISTANCE') {
      serial.setDistanceMode();
      serial.setRaceLengthTicks(model.totalRaceTicks);
    } else {
      serial.setTimeMode();
      serial.setRaceDuration(Math.round(model.raceLengthMillis / 1000));
    }
    serial.startRace();
    if (model.logRaces) csvLogger.log(SS_EVENT.RACE_START, '', '', '', '');
  }

  // ── STOPPED: halt Arduino and clear elapsed time ─────────────────────────
  else if (newState === RACE_STATE.STOPPED) {
    serial.stopRace();
    model.elapsedRaceTimeMillis = 0;
    if (model.logRaces) {
      csvLogger.log(SS_EVENT.RACE_STOP, '', '', '', '');
      csvLogger.write();
    }
  }

  // ── COMPLETE: halt Arduino, log final results, broadcast winner data ──────
  else if (newState === RACE_STATE.COMPLETE) {
    serial.stopRace();
    _logRaceFinish();
    broadcast({ type: 'race_finished', data: model.toJSON() });
  }
});

stateManager.on('appStateChange', (newState, prev) => {
  broadcast({ type: 'app_state', state: newState, prev });
});

// High-frequency race tick — broadcast raw model snapshot to all browsers.
stateManager.on('raceUpdate', data => {
  broadcast({ type: 'race_update', data });
});

stateManager.on('racerFinished', (racerId, timeMillis, ticks) => {
  broadcast({ type: 'racer_finished', racerId, timeMillis, ticks });
});

stateManager.on('falseStart', racerId => {
  broadcast({ type: 'false_start', racerId });
  if (model.logRaces) csvLogger.log(SS_EVENT.RACE_FALSE_START, racerId, '', '', '');
});

// ── Arduino connection events ─────────────────────────────────────────────────

stateManager.on('arduinoConnected', port => {
  broadcast({ type: 'arduino_connected', port });
});

stateManager.on('arduinoDisconnected', () => {
  broadcast({ type: 'arduino_disconnected' });
});

// When Arduino identifies itself (V: response), sync current race settings to it.
// This ensures the correct race type + length are set even after a cable reconnect.
// Mirrors the implicit sync that happens via GFXMain's startup flow.
stateManager.on('arduinoIdentified', version => {
  console.log(`[Server] Arduino identified: ${version} — syncing race settings`);
  if (model.raceType === 'DISTANCE') {
    serial.setDistanceMode();
    serial.setRaceLengthTicks(model.totalRaceTicks);
  } else {
    serial.setTimeMode();
    serial.setRaceDuration(Math.round(model.raceLengthMillis / 1000));
  }
  broadcast({ type: 'arduino_identified', version, connectionState: model.serialConnectionState });
});

serial.on('portListUpdated', ports => {
  broadcast({ type: 'port_list', ports });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SilverSprints → http://localhost:${PORT}`);
  serial.start();
});

// ── Graceful shutdown — mirrors SilverSprintApp::cleanup() ───────────────────

function _shutdown(signal) {
  console.log(`\n[${signal}] Saving config and shutting down…`);
  _saveConfig();
  serial.stop();
  server.close(() => process.exit(0));
}

process.on('SIGINT',  () => _shutdown('SIGINT'));
process.on('SIGTERM', () => _shutdown('SIGTERM'));
