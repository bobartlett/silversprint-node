# SilverSprints — Node.js Edition

A head-to-head bicycle sprint display for Raspberry Pi.
Reads encoder ticks from an OpenSprints Arduino, displays speed/distance/progress in a full-screen browser.

---

## Quick start (development / Mac)

```bash
cd silversprint-node
npm install
npm start          # → http://localhost:3000
```

Open `http://localhost:3000` in any browser. Without an Arduino connected you can enable mock mode (simulated riders) from the browser console or via:

```bash
curl -X POST http://localhost:3000/api/command \
  -H 'Content-Type: application/json' \
  -d '{"cmd":"mock"}'
```

Press **START** to begin a mock race. Press **STOP** or click the winner modal to end it.

---

## Using the app

### Nav bar (top-left icons)

| Icon | View | Shortcut |
|------|------|----------|
| Flag | Race | click or `1` |
| Roster | Enter player names | click or `2` |
| Gear | Settings | click or `3` |

**Keyboard shortcuts** (ignored while typing in a field): `1`/`2`/`3` switch views,
`Space` starts/stops the race, `m` toggles mock mode. A yellow **MOCK** badge appears
top-center while mock mode is active.

### Race view

- **START** button (top-right) begins the countdown and starts the race.
- **STOP** ends the race immediately.
- The central dial shows animated progress rings — one per racer, outermost = player 1.
- Player rows (below the dial) show name, current speed, and elapsed time or distance.
- When all racers finish, the winner modal appears. Click anywhere on it to dismiss.

### Roster view

- Type player names into the coloured fields (one per racer).
- **Tab** moves to the next field.
- Names are saved automatically when you click away from a field.
- The number of visible fields matches the **Number of Racers** setting.

### Settings view

| Control | What it does |
|---------|-------------|
| Roller Diameter (mm) | Circumference of the roller contacting the rear tyre. Default 114.3 mm (4.5 in, OpenSprints standard). |
| Number of Racers | 1–4. Use + / − buttons. |
| Hardware Select | Dropdown of detected serial ports. Pick the Arduino port. |
| Hardware Connection Status | Read-only indicator — filled = connected and identified. |
| Distance Race / Time Race | Radio buttons toggle race mode. |
| Race Length (m) | Distance each rider must cover (distance mode). |
| Race Time (s) | Countdown duration in seconds (time mode). |
| MPH / KPH | Speed units displayed on player rows and winner modal. |
| Log Races to File | Appends a CSV row to `~/SilverSprintsRaceLogs/` after each race. |

All changes are applied immediately and saved to `~/.config/silversprint/settings.json`.

---

## Deploying to Raspberry Pi

### Prerequisites

- Raspberry Pi 4 (or 3B+) running **Raspberry Pi OS Bookworm** with the LXDE desktop.
- The Pi is set to **boot to desktop with auto-login** (`sudo raspi-config` → System Options → Boot).

### Steps

**1. Copy the project to the Pi**

From your Mac (replace `raspberrypi.local` with your Pi's hostname or IP):

```bash
rsync -av --exclude node_modules \
  silversprint-node/ pi@raspberrypi.local:~/silversprint-node/
```

**2. Run the setup script**

SSH in and run once:

```bash
ssh pi@raspberrypi.local
cd ~/silversprint-node
chmod +x deploy/setup.sh
./deploy/setup.sh
```

The script will:
- Install Node.js LTS, build tools, `unclutter`, and Chromium
- Add your user to the `dialout` group (Arduino serial access)
- Run `npm install`
- Install and start the `silversprint` systemd service
- Install the Chromium kiosk autostart for LXDE

**3. Reboot**

```bash
sudo reboot
```

On boot, Chromium opens full-screen on `http://localhost:3000`. Plug in the Arduino and it will be detected automatically within a few seconds.

### Service management

```bash
sudo systemctl status silversprint     # is it running?
sudo systemctl restart silversprint    # restart after code changes
journalctl -fu silversprint            # live logs
```

### Updating after code changes

```bash
# On your Mac — rsync changed files
rsync -av --exclude node_modules silversprint-node/ pi@raspberrypi.local:~/silversprint-node/

# On the Pi — restart the server
sudo systemctl restart silversprint
# Chromium will reconnect automatically via WebSocket backoff
```

---

## File structure

```
silversprint-node/
│
├── server.js               # Entry point. Express + WebSocket server.
│                           # REST routes + state machine → serial wiring.
│
├── src/
│   ├── StateManager.js     # APP_STATE / RACE_STATE enums, EventEmitter singleton.
│   ├── Model.js            # Race settings + player data snapshot. Singleton.
│   ├── PlayerData.js       # Per-racer tick math, speed averaging (CircBuffer).
│   ├── SerialReader.js     # Arduino serial protocol (both directions).
│   ├── Config.js           # JSON config at ~/.config/silversprint/settings.json
│   ├── CsvLogger.js        # Race result logging to CSV.
│   └── utils.js            # millisToTimestamp() helper.
│
├── public/
│   ├── index.html          # Markup only — links css/app.css + js/main.js.
│   ├── css/
│   │   └── app.css         # All styles (fixed 1920×1080 coordinate space).
│   ├── js/                 # ES modules — no build step, native browser modules.
│   │   ├── main.js         # Entry: wires views, keyboard, initial render, WS.
│   │   ├── state.js        # Client state store + applyModel().
│   │   ├── api.js          # apiPost() + navigate().
│   │   ├── ws.js           # WebSocket manager + message dispatch().
│   │   ├── util.js         # millisToTimestamp(), rescale().
│   │   ├── race-view.js    # Race view rendering + ring scheduling.
│   │   ├── rings.js        # Canvas progress-ring renderer.
│   │   ├── settings-view.js # Settings controls.
│   │   ├── roster-view.js  # Roster name inputs.
│   │   └── overlays.js     # Countdown + winner modal.
│   ├── fonts/              # UbuntuMono (R, B, RI, BI) — copied from Cinder assets.
│   └── img/                # Background, dial, countdown, logo images.
│
├── deploy/
│   ├── setup.sh            # One-shot Raspberry Pi setup script.
│   ├── silversprint.service   # systemd unit file.
│   └── autostart           # LXDE kiosk autostart (screen blanking + Chromium).
│
├── test-phase2.js          # Smoke tests for the REST API (needs server running).
└── package.json
```

### Key relationships

```
Arduino  ──serial──►  SerialReader.js
                            │  emits events
                            ▼
                      StateManager.js  ◄──  REST /api/command
                            │  emits events
                            ▼
                        server.js  ──WebSocket──►  index.html
                            │
                         Model.js  (single source of truth for race data)
```

---

## Manual customisation

All common changes are straightforward edits to a single file.

### Change the default roller diameter

`src/Model.js` line 30 and `src/Config.js` default:

```js
// src/Model.js
this.rollerDiameterMm = 114.3;   // ← change here
```

Also change the default in `server.js` `_applyConfigToModel()`:

```js
model.setRollerDiameterMm(config.get('roller_diameter_mm', 114.3));   // ← same value
```

### Change the default race distance or time

`server.js`, `_applyConfigToModel()`:

```js
model.setRaceLengthMeters(config.get('race_length_meters', 100));   // metres
model.raceLengthMillis = config.get('race_time', 60) * 1000;        // seconds
```

### Change player colours

`src/Model.js` lines 4–9 and `public/index.html` line ~443.
They must match — both use the same constant:

```js
// src/Model.js  (server-side, sent to browser in JSON)
const PLAYER_COLORS = ['#b92140', '#1c9185', '#169254', '#e1b909'];

// public/js/state.js  (client-side, used for CSS and Canvas drawing)
export const PLAYER_COLORS = ['#b92140', '#1c9185', '#169254', '#e1b909'];
```

Edit both arrays to the same values and restart the server.

### Change the number of default racers

`server.js`, `_applyConfigToModel()`:

```js
model.numRacers = config.get('num_racers', 2);   // ← default 2
```

### Change the server port

```bash
PORT=8080 npm start
```

Or set `PORT=8080` in `/etc/systemd/system/silversprint.service` under `[Service]`:

```ini
Environment=PORT=8080
```

Then update the Chromium URL in `deploy/autostart` to match.

### Network binding

The server binds to `0.0.0.0` by default so a separate Chromium (on the Pi or another
machine on the LAN) can connect. To restrict it to loopback only, set `HOST=127.0.0.1`:

```bash
HOST=127.0.0.1 npm start
```

The Electron desktop build (`npm run electron`) sets this automatically — its bundled
server is reachable only from the app itself, not the network.

### Adjust ring animation tail length

The tail length is proportional to speed. Edit `public/js/rings.js`, function `drawRings()`:

```js
// tailLen mirrors: lmap(mph, 0, 30, 0, 0.30), clamp(0, 0.50)
const tailLen = Math.min(Math.max((p.mph / 30.0) * 0.30, 0), 0.50);
//                                  ^^^^^ ^^^^ speed at which tail is 30% long
//                                                            ^^^^ max tail length
```

Increase `0.30` for a longer tail at the same speed. Increase `0.50` to allow the tail to grow further.

### Edit the race UI layout

All layout coordinates in `public/css/app.css` are annotated with the original C++ source they came from (e.g. `/* RaceView.cpp Rectf(834,105,...) */`). Pixel values are in the fixed 1920×1080 coordinate space — the viewport scaling is handled automatically.

### Enable race logging permanently

In `~/.config/silversprint/settings.json`:

```json
{ "log_races": true }
```

Or toggle it in the Settings view. Logs appear in `~/SilverSprintsRaceLogs/`.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Arduino not detected | Check `dmesg \| tail -20` for `/dev/ttyACM0`. Ensure user is in `dialout` group (`groups`). Reboot after adding. |
| Chromium shows "Connection refused" on boot | The server may not be ready. The autostart has a 3 s delay; increase it in `deploy/autostart` if needed. |
| Speed reads zero during mock mode | Mock mode hardcodes 114.3 mm roller diameter in the Arduino firmware — tick counts are correct but speed display may differ if you changed the roller setting. |
| Black screen / no desktop | Ensure Pi is set to boot to desktop with auto-login (`sudo raspi-config`). |
| `npm install` fails with build errors | Run `sudo apt-get install -y build-essential` first (required for `serialport` native bindings). |
