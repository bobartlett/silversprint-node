'use strict';
const fs   = require('fs');
const path = require('path');
const os   = require('os');

// On Linux/RPi: ~/.config/silversprint/settings.json
// Keeps the same JSON schema as the C++ version so existing config files
// from macOS can be dropped in and read without changes.
const CONFIG_DIR  = path.join(os.homedir(), '.config', 'silversprint');
const CONFIG_PATH = path.join(CONFIG_DIR, 'settings.json');

// Mirrors the C++ Config defaults
const DEFAULTS = {
  race_type:           0,      // 0 = distance, 1 = time
  roller_diameter_mm:  114.3,
  num_racers:          2,
  race_length_meters:  100.0,
  race_time:           60,     // seconds
  race_kph:            true,
  log_races:           false,
  fullscreen:          false,
};

class Config {
  constructor() {
    this._settings = {};
    this._app      = {};
  }

  read() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw    = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        this._settings = parsed?.configuration?.settings ?? {};
        this._app      = parsed?.configuration?.app      ?? {};
        console.log(`[Config] Loaded from ${CONFIG_PATH}`);
        return true;
      }
    } catch (e) {
      console.warn('[Config] Failed to read, using defaults:', e.message);
    }
    return false;
  }

  write() {
    try {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
      const out = {
        configuration: {
          settings: this._settings,
          app:      this._app,
        },
      };
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(out, null, 2));
      console.log(`[Config] Written to ${CONFIG_PATH}`);
      return true;
    } catch (e) {
      console.error('[Config] Failed to write:', e.message);
      return false;
    }
  }

  get(key, fallback) {
    const val = this._settings[key];
    if (val !== undefined && val !== null) return val;
    if (fallback !== undefined)            return fallback;
    return DEFAULTS[key];
  }

  set(key, value) {
    this._settings[key] = value;
  }

  getAppSetting(key, fallback) {
    const val = this._app[key];
    return val !== undefined ? val : fallback;
  }

  setAppSetting(key, value) {
    this._app[key] = value;
  }

  get path() { return CONFIG_PATH; }
}

// Singleton
const config = new Config();
module.exports = { config, DEFAULTS };
