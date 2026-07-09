'use strict';

import { updatePlayerRows, updateRaceTick, updateStartStopBtn } from './race-view.js';
import { refreshSettingsView } from './settings-view.js';
import { refreshRosterView } from './roster-view.js';

// ── Exact player colours from Model.cpp ──────────────────────────────────────
export const PLAYER_COLORS = ['#b92140', '#1c9185', '#169254', '#e1b909'];

// ── Client-side state store (mirrors server Model) ───────────────────────────
export const state = {
  appState:  'RACE',
  raceState: 'RACE_STOPPED',

  players: PLAYER_COLORS.map((color, i) => ({
    name: '', color,
    mph: 0, kph: 0,
    maxMph: 0, maxKph: 0,
    distanceMeters: 0, distanceFeet: 0,
    percent: 0, ticks: 0,
    finished: false, finishTimeMillis: 0,
  })),

  numRacers:            2,
  raceType:             'DISTANCE',
  raceLengthMeters:     100,
  raceLengthMillis:     60000,
  totalRaceTicks:       278,
  rollerDiameterMm:     114.3,
  useKph:               true,
  logRaces:             false,

  serialConnectionState: 'DISCONNECTED',
  serialDeviceList:      [],
  selectedPortName:      '',
  firmwareVersion:       'Unknown',
  elapsedRaceTimeMillis: 0,
};

// ── Apply full model snapshot ─────────────────────────────────────────────────
export function applyModel(data) {
  if (!data) return;
  Object.assign(state, {
    numRacers:            data.numRacers            ?? state.numRacers,
    raceType:             data.raceType             ?? state.raceType,
    raceLengthMeters:     data.raceLengthMeters     ?? state.raceLengthMeters,
    raceLengthMillis:     data.raceLengthMillis     ?? state.raceLengthMillis,
    totalRaceTicks:       data.totalRaceTicks        ?? state.totalRaceTicks,
    rollerDiameterMm:     data.rollerDiameterMm     ?? state.rollerDiameterMm,
    useKph:               data.useKph               ?? state.useKph,
    logRaces:             data.logRaces             ?? state.logRaces,
    serialConnectionState: data.serialConnectionState ?? state.serialConnectionState,
    serialDeviceList:     data.serialDeviceList      ?? state.serialDeviceList,
    selectedPortName:     data.selectedPortName      ?? state.selectedPortName,
    firmwareVersion:      data.firmwareVersion       ?? state.firmwareVersion,
    elapsedRaceTimeMillis: data.elapsedRaceTimeMillis ?? state.elapsedRaceTimeMillis,
  });
  if (data.players) {
    data.players.forEach((p, i) => Object.assign(state.players[i], p));
  }
  updatePlayerRows();
  updateRaceTick();
  updateStartStopBtn();
  refreshSettingsView();
  refreshRosterView();
}
