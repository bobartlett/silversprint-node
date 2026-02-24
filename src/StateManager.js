'use strict';
const { EventEmitter } = require('events');

const APP_STATE = {
  RACE:     'RACE',
  ROSTER:   'ROSTER',
  SETTINGS: 'SETTINGS',
};

const RACE_STATE = {
  STARTING:     'RACE_STARTING',
  COUNTDOWN_3:  'RACE_COUNTDOWN_3',
  COUNTDOWN_2:  'RACE_COUNTDOWN_2',
  COUNTDOWN_1:  'RACE_COUNTDOWN_1',
  COUNTDOWN_GO: 'RACE_COUNTDOWN_GO',
  RUNNING:      'RACE_RUNNING',
  STOPPED:      'RACE_STOPPED',
  COMPLETE:     'RACE_COMPLETE',
  FALSE_START:  'RACE_FALSE_START',
};

class StateManager extends EventEmitter {
  constructor() {
    super();
    this.appState  = APP_STATE.RACE;
    this.raceState = RACE_STATE.STOPPED;
  }

  changeAppState(newState) {
    const prev = this.appState;
    this.appState = newState;
    this.emit('appStateChange', newState, prev);
  }

  changeRaceState(newState) {
    this.raceState = newState;
    this.emit('raceStateChange', newState);
  }
}

// Singleton
const stateManager = new StateManager();

module.exports = { stateManager, StateManager, APP_STATE, RACE_STATE };
