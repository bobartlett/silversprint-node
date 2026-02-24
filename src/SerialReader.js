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
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  start() {
    this._scheduleReconnect();
    // Keep the browser's port-picker dropdown up to date
    this._portListTimer = setInterval(() => this._updatePortList(), 2000);
  }

  stop() {
    clearTimeout(this._reconnectTimer);
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
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._tryConnect(), RECONNECT_DELAY_MS);
  }

  async _tryConnect() {
    if (this._connected) return;

    try {
      const ports = await SerialPort.list();

      let targetPort = null;

      // 1. User-selected port wins.
      if (this._preferredPortPath) {
        targetPort = ports.find(p => p.path === this._preferredPortPath);
      }

      // 2. Auto-detect: Arduino shows up as ttyACM* (native USB) or ttyUSB*
      //    (FTDI) on Linux/RPi. On macOS it's /dev/cu.usbmodem* or /dev/cu.usbserial*.
      //    Also check the manufacturer string for 'Arduino'.
      if (!targetPort) {
        targetPort = ports.find(p =>
          /arduino/i.test(p.manufacturer ?? '') ||
          /ttyACM/i.test(p.path) ||
          /ttyUSB/i.test(p.path) ||
          /usbmodem/i.test(p.path) ||
          /usbserial/i.test(p.path)
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
    setTimeout(() => this.getVersion(), VERSION_DELAY_MS);
  }

  _onDisconnect() {
    this._connected = false;
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
        portDescription: p.manufacturer ?? p.friendlyName ?? '',
      }));
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
        // Emit for WebSocket broadcast (high frequency — ~100Hz from Arduino)
        this._stateManager.emit('raceUpdate', model.toJSON());
        break;
      }

      // ── Racer finish: 0F:millis … 3F:millis ────────────────────────────────
      case '0F':
      case '1F':
      case '2F':
      case '3F': {
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
          model.startTimeMillis = Date.now();
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

      case 'M':
        console.log(`[Serial] Mock mode: ${args}`);
        break;

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
