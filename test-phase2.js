#!/usr/bin/env node
'use strict';
// Quick smoke-test for Phase 2 — run with: node test-phase2.js
// Requires the server to already be running on port 3000.

const BASE = 'http://localhost:3000';

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path) {
  return (await fetch(`${BASE}${path}`)).json();
}

async function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  console.log('=== Phase 2 smoke tests ===\n');

  // 1. Roller diameter → ticks recalculation (floor not round, mirrors C++)
  await post('/api/settings', { roller_diameter_mm: 100.0 });
  let s = await get('/api/state');
  await check('roller 100mm → ticks 318 (floor(100000/314.159))', s.data.totalRaceTicks, 318);
  await check('rollerDiameterMm updated', s.data.rollerDiameterMm, 100);

  // 2. Race length → ticks
  await post('/api/settings', { race_length_meters: 200 });
  s = await get('/api/state');
  await check('200m with 100mm roller → ticks 636', s.data.totalRaceTicks, 636);

  // 3. Reset to defaults
  await post('/api/settings', { roller_diameter_mm: 114.3, race_length_meters: 100 });
  s = await get('/api/state');
  await check('default 114.3mm 100m → ticks 278', s.data.totalRaceTicks, 278);

  // 4. Navigate
  await post('/api/navigate', { state: 'ROSTER' });
  s = await get('/api/state');
  await check('navigate → ROSTER', s.appState, 'ROSTER');

  await post('/api/navigate', { state: 'SETTINGS' });
  s = await get('/api/state');
  await check('navigate → SETTINGS', s.appState, 'SETTINGS');

  await post('/api/navigate', { state: 'RACE' });
  s = await get('/api/state');
  await check('navigate → RACE', s.appState, 'RACE');

  // 5. Bad navigate returns 400
  const bad = await (await fetch(`${BASE}/api/navigate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'BADSTATE' }),
  }));
  await check('bad navigate → 400', bad.status, 400);

  // 6. Roster names
  await post('/api/roster', { players: [{ name: 'Alice' }, { name: 'Bob' }, { name: 'Carol' }, { name: 'Dan' }] });
  s = await get('/api/state');
  await check('player[0] name', s.data.players[0].name, 'Alice');
  await check('player[1] name', s.data.players[1].name, 'Bob');

  // 7. Race state machine: start → STARTING
  await post('/api/command', { cmd: 'start' });
  s = await get('/api/state');
  await check('start command → RACE_STARTING', s.raceState, 'RACE_STARTING');

  // 8. Stop → STOPPED
  await post('/api/command', { cmd: 'stop' });
  s = await get('/api/state');
  await check('stop command → RACE_STOPPED', s.raceState, 'RACE_STOPPED');

  // 9. Stop when already stopped → still STOPPED (no double-stop)
  await post('/api/command', { cmd: 'stop' });
  s = await get('/api/state');
  await check('stop when already stopped → RACE_STOPPED', s.raceState, 'RACE_STOPPED');

  // 10. Settings persist: num_racers + units
  await post('/api/settings', { num_racers: 4, race_kph: false });
  s = await get('/api/state');
  await check('num_racers 4', s.data.numRacers, 4);
  await check('useKph false', s.data.useKph, false);

  // 11. Time-based race type
  await post('/api/settings', { race_type: 1, race_time: 90 });
  s = await get('/api/state');
  await check('race_type TIME', s.data.raceType, 'TIME');
  await check('raceLengthMillis 90s', s.data.raceLengthMillis, 90000);

  // 12. millisToTimestamp utility (in-process test)
  const { millisToTimestamp } = require('./src/utils');
  await check('0ms → 00:00.00',         millisToTimestamp(0),     '00:00.00');
  await check('1000ms → 00:01.00',      millisToTimestamp(1000),  '00:01.00');
  await check('61500ms → 01:01.50',     millisToTimestamp(61500), '01:01.50');
  await check('negative → 00:00.00',    millisToTimestamp(-500),  '00:00.00');

  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
