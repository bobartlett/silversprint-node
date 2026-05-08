'use strict';
const { PlayerData } = require('./PlayerData');

// Exact colours from Model.cpp constructor (ci::ColorA values converted to hex)
//   playerColors[0] = ColorA(185/255, 33/255,  64/255,  1) → #b92140
//   playerColors[1] = ColorA( 28/255, 145/255, 133/255, 1) → #1c9185
//   playerColors[2] = ColorA( 22/255, 146/255,  84/255, 1) → #169254
//   playerColors[3] = ColorA(225/255, 185/255,   9/255, 1) → #e1b909
const PLAYER_COLORS = ['#b92140', '#1c9185', '#169254', '#e1b909'];

class Model {
  constructor() {
    // Four player slots (always all four, even if fewer are racing)
    this.playerData = [
      new PlayerData(),
      new PlayerData(),
      new PlayerData(),
      new PlayerData(),
    ];
    for (let i = 0; i < 4; i++) {
      this.playerData[i].playerColor = PLAYER_COLORS[i];
    }

    // Race configuration (defaults mirror C++ RaceSettings struct)
    this.numRacers         = 2;
    this.raceType          = 'DISTANCE';   // 'DISTANCE' | 'TIME'
    this.raceLengthMeters  = 100;
    this.totalRaceTicks    = 0;            // derived from raceLengthMeters + rollerDiameterMm
    this.raceLengthMillis  = 60000;        // used for time-based races
    this.rollerDiameterMm  = 114.3;        // 4.5 inches — OpenSprints default
    this.useKph            = true;
    this.logRaces          = false;

    // Serial / hardware state
    this.serialConnectionState = 'DISCONNECTED'; // DISCONNECTED | CONNECTED_UNKNOWN | CONNECTED_SILVERSPRINTS
    this.serialDeviceList      = [];             // [{ portName, portDescription }]
    this.selectedPortName      = '';
    this.firmwareVersion       = 'Unknown';

    // Race timing
    this.elapsedRaceTimeMillis = 0;
  }

  // ── Setters that keep derived state in sync ─────────────────────────────────

  setRollerDiameterMm(mm) {
    this.rollerDiameterMm = mm;
    for (const player of this.playerData) {
      player.setRollerDiameter(mm);
    }
  }

  // Recalculates totalRaceTicks from meters and current roller diameter.
  // Mirrors Model::setRaceLengthMeters() in C++ exactly — uses floor(), not round().
  setRaceLengthMeters(meters) {
    this.raceLengthMeters = meters;
    const totalDistMm  = meters * 1000.0;
    const oneRollerRev = this.rollerDiameterMm * Math.PI;
    this.totalRaceTicks = Math.floor(totalDistMm / oneRollerRev);
    for (const player of this.playerData) {
      player.totalRaceTicks = this.totalRaceTicks;
    }
  }

  resetPlayers() {
    for (const player of this.playerData) {
      player.reset();
    }
    this.elapsedRaceTimeMillis = 0;
  }

  // Returns true when all active racers have finished.
  isRaceFinished() {
    for (let i = 0; i < this.numRacers; i++) {
      if (!this.playerData[i].isFinished()) return false;
    }
    return true;
  }

  // Full snapshot — sent to the browser on connection and after settings changes.
  toJSON() {
    return {
      players:               this.playerData.map(p => p.toJSON()),
      numRacers:             this.numRacers,
      raceType:              this.raceType,
      raceLengthMeters:      this.raceLengthMeters,
      totalRaceTicks:        this.totalRaceTicks,
      raceLengthMillis:      this.raceLengthMillis,
      rollerDiameterMm:      this.rollerDiameterMm,
      useKph:                this.useKph,
      logRaces:              this.logRaces,
      serialConnectionState: this.serialConnectionState,
      serialDeviceList:      this.serialDeviceList,
      selectedPortName:      this.selectedPortName,
      firmwareVersion:       this.firmwareVersion,
      elapsedRaceTimeMillis: this.elapsedRaceTimeMillis,
    };
  }
}

// Singleton — one model for the process lifetime
const model = new Model();
module.exports = { model };
