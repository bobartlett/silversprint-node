'use strict';

// Rolling average buffer — mirrors CheapCircBuffer<double> in the C++ source.
class CircBuffer {
  constructor(size = 10) {
    this._size = size;
    this._buf  = new Array(size).fill(0);
    this._pos  = 0;
    this._count = 0;
  }

  push(val) {
    this._buf[this._pos % this._size] = val;
    this._pos++;
    if (this._count < this._size) this._count++;
  }

  getAverage() {
    if (this._count === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this._count; i++) sum += this._buf[i];
    return sum / this._count;
  }

  reset() {
    this._buf.fill(0);
    this._pos   = 0;
    this._count = 0;
  }
}

class PlayerData {
  constructor() {
    this.playerName    = '';
    this.playerColor   = '#ffffff';
    this.totalRaceTicks = 500;
    this.rollerCircumfMm = 0;      // set via setRollerDiameter()
    this._mphBuffer    = new CircBuffer(10);
    this.reset();
  }

  reset() {
    this.bFinishedRace   = false;
    this.curRaceTicks    = 0;
    this.lastRaceTicks   = 0;
    this.finishTimeMillis = 0;
    this.mph             = 0;
    this.maxMph          = 0;
    this._lastRaceTimeMs = 0;
    this._lastTickTimeMs = 0;
    this._mphBuffer.reset();
  }

  // diameterMm → circumference in mm, matching C++: rollerCircumfMm = diameterMm * M_PI
  setRollerDiameter(diameterMm) {
    this.rollerCircumfMm = diameterMm * Math.PI;
  }

  // Called on every R: message from the Arduino.
  // Mirrors PlayerData::updateRaceTicks() exactly.
  updateRaceTicks(numTicks, curRaceMillis) {
    this.lastRaceTicks   = this.curRaceTicks;
    this.curRaceTicks    = numTicks;

    const dtMillis = curRaceMillis - this._lastRaceTimeMs;
    const dtTicks  = this.curRaceTicks - this.lastRaceTicks;
    this._lastRaceTimeMs = curRaceMillis;

    if (dtMillis > 0 && dtTicks > 0) {
      // Movement detected — compute instantaneous speed and add to average.
      const metersMoved = dtTicks * this.rollerCircumfMm / 1000.0;
      const secsElapsed = dtMillis / 1000.0;
      const kph = (metersMoved / secsElapsed) * 3.6;
      const rawMph = kph * 0.621371;

      this._lastTickTimeMs = curRaceMillis;
      this._mphBuffer.push(rawMph);
      this.mph = this._mphBuffer.getAverage();
      if (this.mph > this.maxMph) this.maxMph = this.mph;
    } else if (dtTicks === 0 && this._lastTickTimeMs > 0) {
      // No movement this interval — zero out speed if idle for more than 2 s.
      if (curRaceMillis - this._lastTickTimeMs > 2000) {
        this._mphBuffer.reset();
        this.mph = 0;
      }
    }
  }

  setFinished(finalTimeMillis, finalRaceTicks) {
    this.bFinishedRace    = true;
    this.finishTimeMillis = finalTimeMillis;
    this.lastRaceTicks    = this.curRaceTicks;
    this.curRaceTicks     = finalRaceTicks;
  }

  // ── Getters (mirror C++ accessors) ─────────────────────────────────────────

  getMph()     { return this.mph; }
  getKph()     { return this.mph * 1.60934; }
  getMaxMph()  { return this.maxMph; }
  getMaxKph()  { return this.maxMph * 1.60934; }
  isFinished() { return this.bFinishedRace; }
  getCurrentRaceTicks() { return this.curRaceTicks; }

  // percent 0–1, clamped
  getPercent() {
    return Math.min(Math.max(this.curRaceTicks / this.totalRaceTicks, 0), 1);
  }

  // distanceMeters = (rollerCircumfMm / 1000) * ticks
  getDistanceMeters() {
    return (this.rollerCircumfMm / 1000.0) * this.curRaceTicks;
  }

  getDistanceFeet() {
    return this.getDistanceMeters() * 3.28084;
  }

  // Serialised snapshot sent over WebSocket on every race tick.
  toJSON() {
    return {
      name:             this.playerName,
      color:            this.playerColor,
      mph:              this.getMph(),
      kph:              this.getKph(),
      maxMph:           this.getMaxMph(),
      maxKph:           this.getMaxKph(),
      distanceMeters:   this.getDistanceMeters(),
      distanceFeet:     this.getDistanceFeet(),
      percent:          this.getPercent(),
      ticks:            this.curRaceTicks,
      finished:         this.bFinishedRace,
      finishTimeMillis: this.finishTimeMillis,
    };
  }
}

module.exports = { PlayerData };
