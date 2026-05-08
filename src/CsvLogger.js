'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const SS_EVENT = {
  RACE_START:           'RACE_START',
  RACE_STOP:            'RACE_STOP',
  RACE_FINISH_TIME:     'RACE_FINISH_TIME',
  RACE_FINISH_DISTANCE: 'RACE_FINISH_DISTANCE',
  RACE_FALSE_START:     'RACE_FALSE_START',
};

class CsvLogger {
  constructor() {
    this._logStr  = '';
    this._headers = [];
  }

  setHeaders(headers) {
    this._headers = headers;
  }

  // Mirrors CsvLogger::log() — prepends ISO 8601 timestamp automatically.
  log(eventType, ...args) {
    const ts  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const row = [ts, eventType, ...args].join(',');
    this._logStr += row + '\n';
  }

  // Appends buffered lines to today's log file, then clears the buffer.
  // Mirrors CsvLogger::write() — file is named YYYY_MM_DD_SilverSprintsRaceLog.csv.
  write(logDir = path.join(os.homedir(), 'SilverSprintsRaceLogs')) {
    try {
      fs.mkdirSync(logDir, { recursive: true });

      const now      = new Date();
      const y        = now.getFullYear();
      const m        = String(now.getMonth() + 1).padStart(2, '0');
      const d        = String(now.getDate()).padStart(2, '0');
      const filename = `${y}_${m}_${d}_SilverSprintsRaceLog.csv`;
      const filepath = path.join(logDir, filename);

      const needsHeader = !fs.existsSync(filepath) && this._headers.length > 0;
      const output = needsHeader
        ? this._headers.join(',') + '\n' + this._logStr
        : this._logStr;

      fs.appendFileSync(filepath, output);
      this.clear();
      console.log(`[CsvLogger] Written to ${filepath}`);
    } catch (e) {
      console.error('[CsvLogger] Failed to write:', e.message);
    }
  }

  clear() {
    this._logStr = '';
  }
}

// Singleton
const csvLogger = new CsvLogger();
module.exports = { csvLogger, SS_EVENT };
