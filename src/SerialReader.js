'use strict';
const { EventEmitter }   = require('events');
const { SerialPort, ReadlineParser } = require('serialport');
const { model }          = require('./Model');
const { RACE_STATE }     = require('./StateManager');

const BAUD_RATE          = 115200;
const RECONNECT_DELAY_MS = 1000;
const VERSION_DELAY_MS   = 2000;  // Wait 2s after connect before requesting version (mirrors C++)

class SerialReader extends EventEmitter {
  constructor(stateManager) {
    super();
    this._stateManager       = stateManager;
    this._port               = null;
    this._parser             = null;
    this._connected          = false;
    this._preferredPortPath  = null;   // set by selectDevice()
    this._reconnectTimer     = null;
    this._portListTimer      = null;
    this._versionTimer       = null;
    this._stopped            = false;  // set by stop() — halts the reconnect loop
    this._disconnecting      = false;  // dedupes paired error+close disconnect events
    this._lastPortListJson   = null;   // dedupes identical port-list broadcasts
    this._lastRaceUpdateEmit = 0;      // throttles high-frequency race broadcasts
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start() {
    this._stopped = false;
    this._scheduleReconnect();
    // Keep the browser's port-picker dropdown up to date
    this._portListTimer = setInterval(() => this._updatePortList(), 2000);
  }

  stop() {
    this._stopped = true;
    clearTimeout(this._reconnectTimer);
    clearTimeout(this._versionTimer);
    clearInterval(this._portListTimer);
    if (this._port && this._port.isOpen) {
      this._port.close();
    }
  }

  // Called when the user picks a port in the Settings view.
  // Mirrors GFXMain's signalSerialDeviceSelected handler: selectSerialDevice() + getVersion().
  selectDevice(portPath) {
    this._preferredPortPath = portPath;
    if (this._port && this._port.isOpen) {
      if (this._port.path === portPath) {
        // Already on this port — just re-request firmware version immediately.
        this.getVersion();
      } else {
        // Different port selected — close current and reconnect.
        this._port.close(() => {
          this._connected = false;
          this._scheduleReconnect();
        });
      }
    }
  }

  // ── Connection management ───────────────────────────────────────────────────

  _scheduleReconnect() {
    if (this._stopped) return;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._tryConnect(), RECONNECT_DELAY_MS);
  }

  async _tryConnect() {
    if (this._stopped) return;
    if (this._connected) return;
    this._disconnecting = false;

    try {
      const ports = await SerialPort.list();

      let targetPort = null;

      // 1. User-selected port wins.
      if (this._preferredPortPath) {
        targetPort = ports.find(p => p.path === this._preferredPortPath);
      }

      // 2. Auto-detect by manufacturer name or known USB-serial vendor IDs.
      //    Linux/RPi: ttyACM* (native USB) or ttyUSB* (FTDI/CH340).
      //    macOS: /dev/cu.usbmodem* or /dev/cu.usbserial*.
      //    Windows: COM port with manufacturer or vendorId matching common chips:
      //      2341 = Arduino LLC, 1a86 = CH340 (clones), 10c4 = CP210x, 0403 = FTDI
      if (!targetPort) {
        targetPort = ports.find(p =>
          /arduino/i.test(p.manufacturer ?? '') ||
          /ttyACM/i.test(p.path) ||
          /ttyUSB/i.test(p.path) ||
          /usbmodem/i.test(p.path) ||
          /usbserial/i.test(p.path) ||
          ['2341', '1a86', '10c4', '0403'].includes((p.vendorId ?? '').toLowerCase())
        );
      }

      if (!targetPort) {
        // Nothing found yet — try again in a second.
        this._scheduleReconnect();
        return;
      }

      this._port = new SerialPort({
        path:      targetPort.path,
        baudRate:  BAUD_RATE,
        autoOpen:  false,
      });

      // ReadlineParser splits on \r\n (what Arduino's Serial.println() sends).
      this._parser = this._port.pipe(new ReadlineParser({ delimiter: '\r\n' }));
      this._parser.on('data', line => this._parseLine(line));

      this._port.on('error', err => {
        console.error('[Serial] Error:', err.message);
        this._onDisconnect();
      });

      this._port.on('close', () => {
        console.log('[Serial] Port closed');
        this._onDisconnect();
      });

      // Open the port (promisified)
      await new Promise((resolve, reject) => {
        this._port.open(err => (err ? reject(err) : resolve()));
      });

      this._connected = true;
      model.selectedPortName = targetPort.path;
      console.log(`[Serial] Connected on ${targetPort.path}`);
      this._onConnect();

    } catch (err) {
      console.error('[Serial] Connect failed:', err.message);
      this._connected = false;
      this._scheduleReconnect();
    }
  }

  _onConnect() {
    model.serialConnectionState = 'CONNECTED_UNKNOWN';
    model.firmwareVersion       = 'Unknown';
    this._stateManager.emit('arduinoConnected', model.selectedPortName);
    // Request firmware version after a short settle delay (mirrors C++ 2s timeline call)
    clearTimeout(this._versionTimer);
    this._versionTimer = setTimeout(() => this.getVersion(), VERSION_DELAY_MS);
  }

  _onDisconnect() {
    // A port 'error' and the following 'close' both land here for one disconnect.
    if (this._disconnecting) return;
    this._disconnecting = true;

    this._connected = false;
    clearTimeout(this._versionTimer);
    // Release the (possibly still-open) handle before reconnecting, or the OS
    // keeps the device locked and the next open() fails.
    if (this._port && this._port.isOpen) {
      this._port.close(() => {});
    }
    this._port   = null;
    this._parser = null;
    model.serialConnectionState = 'DISCONNECTED';
    this._stateManager.emit('arduinoDisconnected');
    this._scheduleReconnect();
  }

  // ── Port list (for Settings dropdown) ──────────────────────────────────────

  async _updatePortList() {
    try {
      const ports = await SerialPort.list();
      const list  = ports.map(p => ({
        portName:        p.path,
        portDescription: p.friendlyName ?? p.manufacturer ?? '',
      }));
      // Skip the broadcast when nothing changed — avoids waking every client
      // (and collapsing an open port dropdown) twice a second.
      const listJson = JSON.stringify(list);
      if (listJson === this._lastPortListJson) return;
      this._lastPortListJson = listJson;
      model.serialDeviceList = list;
      this.emit('portListUpdated', list);
    } catch (_) {
      // Non-fatal — silently ignore transient errors
    }
  }

  // ── Message parsing ─────────────────────────────────────────────────────────

  _parseLine(raw) {
    const line = raw.trim();
    if (!line) return;

    // Split on the first colon only — args may contain commas but not extra colons
    const colonIdx = line.indexOf(':');
    const cmd  = colonIdx !== -1 ? line.slice(0, colonIdx) : line;
    const args = colonIdx !== -1 ? line.slice(colonIdx + 1) : '';

    this._handleCommand(cmd, args);
  }

  _handleCommand(cmd, args) {
    switch (cmd) {

      // ── Kiosk start / stop ──────────────────────────────────────────────────
      case 'G':
        if (this._stateManager.raceState === RACE_STATE.STOPPED) {
          this._stateManager.changeRaceState(RACE_STATE.STARTING);
        }
        break;

      case 'S':
        this._stateManager.changeRaceState(RACE_STATE.STOPPED);
        break;

      // ── Race progress: R:tick0,tick1,tick2,tick3,raceMillis ────────────────
      case 'R': {
        // Ignore stale progress arriving after a stop/finish.
        if (this._stateManager.raceState !== RACE_STATE.RUNNING) break;
        const parts = args.split(',');
        if (parts.length < 5) {
          console.warn('[Serial] Malformed R: message:', args);
          break;
        }
        const raceMillis = parseInt(parts[4], 10);
        for (let i = 0; i < 4; i++) {
          model.playerData[i].updateRaceTicks(parseInt(parts[i], 10), raceMillis);
        }
        model.elapsedRaceTimeMillis = raceMillis;
        // Model math runs on every message; throttle the broadcast to ~30Hz.
        // Final values are still exact — racerFinished / race_finished carry the
        // authoritative snapshot at the end of the race.
        const now = Date.now();
        if (now - this._lastRaceUpdateEmit >= 33) {
          this._lastRaceUpdateEmit = now;
          this._stateManager.emit('raceUpdate', model.toRaceJSON());
        }
        break;
      }

      // ── Racer finish: 0F:millis … 3F:millis ────────────────────────────────
      case '0F':
      case '1F':
      case '2F':
      case '3F': {
        // Ignore stale finish messages arriving after a stop — they must not
        // re-complete an idle race and pop the winner modal.
        if (this._stateManager.raceState !== RACE_STATE.RUNNING) break;
        const racerId     = parseInt(cmd[0], 10);
        const finishMs    = parseInt(args, 10);
        const finalTicks  = model.playerData[racerId].getCurrentRaceTicks();
        model.playerData[racerId].setFinished(finishMs, finalTicks);
        console.log(`[Serial] Racer ${racerId} finished at ${finishMs}ms`);
        this._stateManager.emit('racerFinished', racerId, finishMs, finalTicks);
        if (model.isRaceFinished()) {
          this._stateManager.changeRaceState(RACE_STATE.COMPLETE);
          this._stateManager.emit('raceFinished');
        }
        break;
      }

      // ── Countdown: CD:3 → CD:2 → CD:1 → CD:0 (GO!) ────────────────────────
      case 'CD':
        if      (args === '3') { this._stateManager.changeRaceState(RACE_STATE.COUNTDOWN_3); }
        else if (args === '2') { this._stateManager.changeRaceState(RACE_STATE.COUNTDOWN_2); }
        else if (args === '1') { this._stateManager.changeRaceState(RACE_STATE.COUNTDOWN_1); }
        else if (args === '0') {
          this._stateManager.changeRaceState(RACE_STATE.COUNTDOWN_GO);
          // Immediately transition to RUNNING (mirrors C++ double-emit)
          this._stateManager.changeRaceState(RACE_STATE.RUNNING);
        }
        break;

      // ── False start: FS:racerId ─────────────────────────────────────────────
      case 'FS':
        console.log(`[Serial] False start: racer ${args}`);
        this._stateManager.emit('falseStart', parseInt(args, 10));
        break;

      // ── Firmware version: V:SS_v0.1.7 ──────────────────────────────────────
      case 'V':
        model.firmwareVersion       = args;
        model.serialConnectionState = 'CONNECTED_SILVERSPRINTS';
        console.log(`[Serial] Firmware version: ${args}`);
        this._stateManager.emit('arduinoIdentified', args);
        break;

      // ── Confirmations (logged, not acted on) ────────────────────────────────
      case 'L':
        console.log(`[Serial] Race length confirmed: ${args} ticks`);
        break;

      case 'M': {
        // Arduino echoes its mock-mode state. Parse permissively — treat
        // 1/on/true (any case) as enabled, everything else as disabled.
        const on = /^\s*(1|on|true)\s*$/i.test(args);
        console.log(`[Serial] Mock mode: ${args}`);
        this._stateManager.emit('mockMode', on);
        break;
      }

      default:
        if (cmd.startsWith('ERROR')) {
          console.warn('[Serial] Arduino error:', args);
        } else {
          console.log(`[Serial] Unknown: ${cmd}:${args}`);
        }
    }
  }

  // ── Send helpers ────────────────────────────────────────────────────────────

  _send(msg) {
    if (!this._connected || !this._port?.isOpen) {
      console.warn('[Serial] Not connected, cannot send:', msg);
      return;
    }
    // Arduino expects messages terminated with '\n'
    this._port.write(msg + '\n', err => {
      if (err) console.error('[Serial] Write error:', err.message);
    });
  }

  // ── Public command API (mirrors C++ SerialReader methods) ──────────────────
  startRace()              { this._send('g'); }
  stopRace()               { this._send('s'); }
  getVersion()             { this._send('v'); }
  setRaceLengthTicks(t)    { this._send(`l${t}`); }
  setRaceDuration(secs)    { this._send(`t${secs}`); }
  setDistanceMode()        { this._send('d'); }
  setTimeMode()            { this._send('x'); }
  toggleMockMode()         { this._send('m'); }
}

module.exports = { SerialReader };
