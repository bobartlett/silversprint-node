'use strict';

import { state } from './state.js';
import { apiPost } from './api.js';
import { updatePlayerRows } from './race-view.js';

export function refreshSettingsView() {
  const el = id => document.getElementById(id);
  // Don't overwrite a field the user is actively editing (a broadcast can arrive
  // mid-edit when another field blurs).
  const setIfIdle = (id, val) => {
    const node = el(id);
    if (document.activeElement !== node) node.value = val;
  };
  setIfIdle('s-roller',   state.rollerDiameterMm);
  el('s-racers-val').value = state.numRacers;   // readonly — safe to always set
  setIfIdle('s-distance', state.raceLengthMeters);
  setIfIdle('s-racetime', Math.round(state.raceLengthMillis / 1000));
  selectRaceTypeUI(state.raceType);
  selectUnitsUI(state.useKph);
  el('s-log-check').classList.toggle('checked', state.logRaces);
  updatePortDropdown();
  updateConnectionStatus();
}

export function updatePortDropdown() {
  const sel = document.getElementById('s-port');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— no device —';
  sel.appendChild(none);
  state.serialDeviceList.forEach(d => {
    const opt = document.createElement('option');
    opt.value       = d.portName;
    opt.textContent = d.portName;
    opt.selected    = d.portName === state.selectedPortName;
    sel.appendChild(opt);
  });
}

export function updateConnectionStatus() {
  const connected = state.serialConnectionState !== 'DISCONNECTED';
  document.getElementById('s-conn-check').classList.toggle('checked', connected);
  const fw   = state.firmwareVersion;
  const show = connected && fw && fw !== 'Unknown';
  document.getElementById('s-fw-label').style.display = show ? '' : 'none';
  document.getElementById('s-fw-ver').style.display   = show ? '' : 'none';
  if (show) document.getElementById('s-fw-ver').textContent = fw;
}

function selectRaceTypeUI(raceType) {
  document.getElementById('s-dist-radio').classList.toggle('checked', raceType === 'DISTANCE');
  document.getElementById('s-time-radio').classList.toggle('checked', raceType === 'TIME');
  document.getElementById('s-distance').style.display  = raceType === 'DISTANCE' ? '' : 'none';
  document.getElementById('s-racetime').style.display  = raceType === 'TIME'     ? '' : 'none';
  document.getElementById('s-len-label').style.display = raceType === 'DISTANCE' ? '' : 'none';
  document.getElementById('s-time-label').style.display= raceType === 'TIME'     ? '' : 'none';
}

function selectUnitsUI(useKph) {
  document.getElementById('s-mph-side').classList.toggle('active', !useKph);
  document.getElementById('s-kph-side').classList.toggle('active',  useKph);
}

function selectRaceType(type) {
  selectRaceTypeUI(type);
  apiPost('/api/settings', { race_type: type === 'DISTANCE' ? 0 : 1 });
}

function selectUnits(useKph) {
  selectUnitsUI(useKph);
  apiPost('/api/settings', { race_kph: useKph });
}

function toggleLogRaces() {
  const box    = document.getElementById('s-log-check');
  const newVal = !box.classList.contains('checked');
  box.classList.toggle('checked', newVal);
  apiPost('/api/settings', { log_races: newVal });
}

function stepRacers(delta) {
  const newVal = Math.max(1, Math.min(4, state.numRacers + delta));
  if (newVal === state.numRacers) return;
  // Update local state immediately so rapid clicks accumulate instead of each
  // computing from the pre-round-trip value.
  state.numRacers = newVal;
  document.getElementById('s-racers-val').value = newVal;
  updatePlayerRows();
  apiPost('/api/settings', { num_racers: newVal });
}

// Wire all settings controls (were inline handlers in the monolith).
export function initSettingsView() {
  const roller = document.getElementById('s-roller');
  roller.addEventListener('blur', () => {
    if (+roller.value > 0) apiPost('/api/settings', { roller_diameter_mm: +roller.value });
  });

  document.getElementById('s-racers-plus').addEventListener('click',  () => stepRacers(1));
  document.getElementById('s-racers-minus').addEventListener('click', () => stepRacers(-1));

  const port = document.getElementById('s-port');
  port.addEventListener('change', () => {
    if (port.value) apiPost('/api/settings', { port: port.value });
  });

  document.getElementById('s-dist-radio').addEventListener('click', () => selectRaceType('DISTANCE'));
  document.getElementById('s-time-radio').addEventListener('click', () => selectRaceType('TIME'));

  const distance = document.getElementById('s-distance');
  distance.addEventListener('blur', () => {
    if (+distance.value > 0) apiPost('/api/settings', { race_length_meters: +distance.value });
  });

  const racetime = document.getElementById('s-racetime');
  racetime.addEventListener('blur', () => {
    if (+racetime.value > 0) apiPost('/api/settings', { race_time: +racetime.value });
  });

  document.getElementById('s-mph-side').addEventListener('click', () => selectUnits(false));
  document.getElementById('s-kph-side').addEventListener('click', () => selectUnits(true));

  document.getElementById('s-log-check').addEventListener('click', toggleLogRaces);
}
