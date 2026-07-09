# SilverSprints — Bug Fix & Refactor Implementation Plan

This plan is ordered by phase. Complete phases in order; each phase is independently
shippable and testable. Do not combine phases into one commit — one commit per phase.

**Testing after every phase:** run `npm start`, open http://localhost:3000, enable mock
mode (`curl -X POST http://localhost:3000/api/command -H 'Content-Type: application/json' -d '{"cmd":"mock"}'`),
run a full race (START → countdown → finish → winner modal → click to dismiss), and check
all three views. Also run `node test-phase2.js` with the server running.

---

## Phase 1 — Bug fixes (backend)

### 1.1 `/api/settings` accepts non-numeric values (server.js:141-171)

**Bug:** the guards use `s.race_time <= 0` style checks. A string like `"abc"` fails the
`<= 0` comparison (it's `false`), passes validation, and produces `NaN` in the model,
which is then persisted to the config file by `_saveConfig()`.

**Fix:** add a helper at the top of the route and validate every numeric field with it:

```js
const isPosNum = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
```

- `roller_diameter_mm`, `race_length_meters`, `race_time`: reject with 400 unless
  `v == null || isPosNum(v)`.
- `num_racers`: keep the existing integer 1–4 check but also require `typeof v === 'number'`.
- `race_type`: reject unless `v == null || v === 0 || v === 1`.
- `race_kph`, `log_races`, `fullscreen`: reject unless `v == null || typeof v === 'boolean'`.
- `port`: reject unless `v == null || typeof v === 'string'`.

### 1.2 `/api/roster` crashes on malformed entries (server.js:125-138)

**Bug:** `players.forEach((p, i) => { ... p.name ... })` throws a 500 if an array entry
is `null` or not an object.

**Fix:** inside the loop, skip entries where `!p || typeof p !== 'object'`. Also cap name
length: `String(p.name).trim().slice(0, 40)`.

### 1.3 Stale racer-finish messages can complete a stopped race (src/SerialReader.js:213-228)

**Bug:** the `0F`–`3F` handler calls `setFinished()` and can transition to
`RACE_STATE.COMPLETE` regardless of the current race state. A late/stale finish message
arriving after STOP pops the winner modal from an idle screen.

**Fix:** at the top of the `'0F' ... '3F'` case block, add:

```js
if (this._stateManager.raceState !== RACE_STATE.RUNNING) break;
```

(Keep everything else identical. `RACE_STATE` is already imported in this file.)

Apply the same guard to the `'R'` case (race progress) — ignore `R:` messages unless
`raceState === RACE_STATE.RUNNING`.

### 1.4 `SerialReader.stop()` re-arms the reconnect loop (src/SerialReader.js:31-37, 144-149)

**Bug:** `stop()` clears the timers and closes the port — but the port's `'close'` event
fires `_onDisconnect()`, which calls `_scheduleReconnect()` again. The reader keeps trying
to reconnect after being stopped.

**Fix:**
- Add `this._stopped = false;` to the constructor.
- In `start()`, set `this._stopped = false;` first.
- In `stop()`, set `this._stopped = true;` first.
- At the top of `_scheduleReconnect()` and `_tryConnect()`, `if (this._stopped) return;`.

### 1.5 Serial error path can leak a locked port handle (src/SerialReader.js:109-117)

**Bug:** on a port `'error'` event, `_onDisconnect()` runs but the port object may still
be open. `_tryConnect()` then constructs a brand-new `SerialPort` while the old handle
still holds the device.

**Fix:** in `_onDisconnect()`, before scheduling reconnect:

```js
if (this._port && this._port.isOpen) {
  this._port.close(() => {});
}
this._port = null;
this._parser = null;
```

Also guard against `_onDisconnect()` running twice for one disconnect (error event
followed by close event): add an early return `if (model.serialConnectionState === 'DISCONNECTED' && !this._connected) return;` at the top — or simpler, track
`this._disconnecting` boolean set true at entry and reset inside `_tryConnect()`.

### 1.6 Version-request timer fires after disconnect (src/SerialReader.js:136-142)

**Minor:** store the timeout: `this._versionTimer = setTimeout(...)` in `_onConnect()`,
and `clearTimeout(this._versionTimer)` in `_onDisconnect()` and `stop()`.

**Acceptance for Phase 1:** `node test-phase2.js` passes; `curl` POSTing
`{"race_time":"abc"}` and `{"roller_diameter_mm":"x"}` to `/api/settings` returns 400;
a mock race still runs end-to-end; Ctrl-C shutdown prints no reconnect attempts afterwards.

---

## Phase 2 — Bug fixes (frontend, public/index.html)

### 2.1 GO! countdown graphic never displays (index.html ~line 1070, `showCountdown`)

**Bug:** the Arduino's `CD:0` makes the server emit `RACE_COUNTDOWN_GO` immediately
followed by `RACE_RUNNING` (see src/SerialReader.js:235-239). The client dispatches both
`race_state` messages back-to-back: `showCountdown('RACE_COUNTDOWN_GO')` starts the GO
animation, then `showCountdown('RACE_RUNNING')` hits the `!imgId` branch and hides the
overlay instantly — so the GO image is never visible.

**Fix:** in `showCountdown()`, only hide the overlay immediately for terminal states:

```js
if (!imgId) {
  if (raceState !== 'RACE_RUNNING') {
    overlay.classList.add('hidden');       // STOPPED / COMPLETE: hide now
  }
  // RACE_RUNNING: do nothing — the GO animation's 1s hide timer (set when
  // RACE_COUNTDOWN_GO was shown) will hide the overlay.
  return;
}
```

Keep the existing `overlay._hideTimer` logic for `RACE_COUNTDOWN_GO` unchanged. Also add
`clearTimeout(overlay._hideTimer)` in the STOPPED/COMPLETE hide branch so a race stopped
mid-GO doesn't get re-hidden later (harmless but clean).

**Test:** run a mock race and confirm 3 → 2 → 1 → GO all animate visibly.

### 2.2 HTML injection via player names (index.html ~line 1160, `populateWinnerModal`)

**Bug:** runner-up boxes are built with `insertAdjacentHTML` and interpolate `${name}`,
`${metric}`, `${speed}` unescaped. A player named `<img src=x onerror=alert(1)>` executes
script. Names come straight from the roster inputs.

**Fix:** build the runner-up boxes with `document.createElement` + `textContent` instead
of an HTML template string. Keep the exact same inline styles (set via `el.style.cssText`
with the same values). No user data may pass through `innerHTML`/`insertAdjacentHTML`.

Do the same in `updatePortDropdown()` (~line 863): create `<option>` elements with
`document.createElement('option')`, `opt.value = d.portName`, `opt.textContent = d.portName`,
`opt.selected = ...` rather than string-building `innerHTML`.

### 2.3 Port dropdown rebuilt every 2 s — closes while the user has it open (index.html ~line 863)

**Bug:** the server broadcasts `port_list` every 2 seconds and `updatePortDropdown()`
rebuilds the `<select>` unconditionally, which collapses an open dropdown and resets
scroll.

**Fix (client):** in the `port_list` case of `dispatch()`, skip the rebuild when nothing
changed and never rebuild while the select is focused:

```js
case 'port_list': {
  const changed = JSON.stringify(msg.ports) !== JSON.stringify(state.serialDeviceList);
  state.serialDeviceList = msg.ports;
  const sel = document.getElementById('s-port');
  if (changed && document.activeElement !== sel) updatePortDropdown();
  break;
}
```

**Fix (server, optional but preferred):** in `src/SerialReader.js` `_updatePortList()`,
only assign `model.serialDeviceList` and emit `portListUpdated` when
`JSON.stringify(list)` differs from the previous value (store `this._lastPortListJson`).

### 2.4 Settings inputs clobbered while typing (index.html ~line 850, `refreshSettingsView`)

**Bug:** every `settings_updated` / `full_state` / `race_finished` message calls
`applyModel()` → `refreshSettingsView()`, which unconditionally overwrites
`s-roller`, `s-distance`, `s-racetime` values — including the field the user is typing
in (the self-echo after any other field blurs is enough to trigger this).

**Fix:** guard each text-field assignment the same way `refreshRosterView()` already does:

```js
const setIfIdle = (id, val) => {
  const el = document.getElementById(id);
  if (document.activeElement !== el) el.value = val;
};
setIfIdle('s-roller',   state.rollerDiameterMm);
setIfIdle('s-distance', state.raceLengthMeters);
setIfIdle('s-racetime', Math.round(state.raceLengthMillis / 1000));
```

(`s-racers-val` is readonly — leave it as a direct assignment.)

### 2.5 Racer stepper ignores rapid clicks (index.html ~line 913, `stepRacers`)

**Bug:** `stepRacers` computes from `state.numRacers`, which only updates after the
WebSocket round-trip. Clicking “+” twice quickly goes 2→3, not 2→4.

**Fix:** update the local state optimistically:

```js
function stepRacers(delta) {
  const newVal = Math.max(1, Math.min(4, state.numRacers + delta));
  if (newVal === state.numRacers) return;
  state.numRacers = newVal;
  document.getElementById('s-racers-val').value = newVal;
  updatePlayerRows();
  apiPost('/api/settings', { num_racers: newVal });
}
```

### 2.6 Winner modal shows `00:00.00` for DNF racers (index.html ~line 1145)

**Bug:** in a distance race, runner-ups who never finished have `finishTimeMillis === 0`
and display as `00:00.00`, which reads as “instant win”.

**Fix:** in `populateWinnerModal()`, when `state.raceType === 'DISTANCE'` and
`!p.finished`, show the string `'DNF'` as the metric instead of the timestamp.

**Acceptance for Phase 2:** mock race shows GO graphic; a player named
`<b>x</b>` renders literally in the winner modal; the port dropdown stays open while
open; typing in Race Length while a broadcast arrives doesn't lose keystrokes;
double-clicking “+” reaches 4 racers.

---

## Phase 3 — Performance

### 3.1 Slim + throttle the high-frequency `race_update` payload

**Problem:** the Arduino sends `R:` at up to ~100 Hz. Each message currently triggers
`model.toJSON()` (full snapshot including `serialDeviceList`, settings, firmware string)
serialized and broadcast to every client (server.js:252-254, src/SerialReader.js:196-210).
Displays can't paint faster than 60 fps, so most of this work is wasted.

**Fix (server):**
1. In `src/SerialReader.js`, the `'R'` case should still update the model on every
   message (timing math must not be throttled), but emit `raceUpdate` at most every 33 ms.
   Add `this._lastRaceUpdateEmit = 0;` to the constructor; in the `'R'` case:

   ```js
   const now = Date.now();
   if (now - this._lastRaceUpdateEmit >= 33) {
     this._lastRaceUpdateEmit = now;
     this._stateManager.emit('raceUpdate', model.toRaceJSON());
   }
   ```

2. Add `toRaceJSON()` to `src/Model.js` — only what the race view needs per tick:

   ```js
   toRaceJSON() {
     return {
       players: this.playerData.map(p => p.toJSON()),
       elapsedRaceTimeMillis: this.elapsedRaceTimeMillis,
     };
   }
   ```

3. `server.js` `raceUpdate` handler is unchanged (it just broadcasts `data`). The client's
   `race_update` case already reads only `elapsedRaceTimeMillis` and `players`, so no
   client change is needed. **Verify** nothing else reads other fields from
   `race_update` payloads.

4. When the race state changes to `RACE_STATE.COMPLETE` or a racer finishes, the full
   snapshot broadcasts already cover the final values — no change needed.

### 3.2 Coalesce client rendering with requestAnimationFrame

**Problem:** `updateRaceTick()` does ~20 DOM writes plus a full canvas ring redraw per
WebSocket message.

**Fix (client):** introduce a dirty-flag render loop:

```js
let _renderQueued = false;
function scheduleRender() {
  if (_renderQueued) return;
  _renderQueued = true;
  requestAnimationFrame(() => { _renderQueued = false; updateRaceTick(); });
}
```

In `dispatch()`, replace direct `updateRaceTick()` calls in the `race_update`,
`racer_finished`, and `roster_updated` cases with `scheduleRender()`. Leave the calls
inside `applyModel()` as-is (they're low-frequency).

**Acceptance for Phase 3:** mock race still animates smoothly; CPU usage of both node
and the browser tab drops noticeably during a race; final times/distances shown in the
winner modal are unchanged (full snapshot on COMPLETE still arrives).

---

## Phase 4 — Frontend restructure (split the 1,350-line index.html)

Goal: same behavior, same pixel layout, but maintainable files. **No build step** —
use native ES modules served statically. Do this as pure code motion plus the mechanical
changes listed; do not redesign anything.

### 4.1 Target layout

```
public/
├── index.html          # markup only (~250 lines)
├── css/
│   └── app.css         # everything currently in the <style> block, unchanged
└── js/
    ├── main.js         # entry: imports everything, initial render, event wiring
    ├── state.js        # the `state` object + PLAYER_COLORS + applyModel()
    ├── api.js          # apiPost(), navigate()
    ├── ws.js           # WSManager + dispatch() (imports view update fns)
    ├── util.js         # millisToTimestamp(), rescale()
    ├── race-view.js    # updateRaceTick, updateTimer, updatePlayerRows,
    │                   # updateStartStopBtn, scheduleRender
    ├── rings.js        # canvas ring renderer (drawRings + helpers)
    ├── settings-view.js# refreshSettingsView, updatePortDropdown,
    │                   # updateConnectionStatus, selectRaceType*, selectUnits*,
    │                   # toggleLogRaces, stepRacers
    ├── roster-view.js  # refreshRosterView, rosterFocus/Blur/Tab
    └── overlays.js     # showCountdown, populateWinnerModal, showWinnerModal
```

### 4.2 Rules for the split

1. `index.html` keeps only markup, `<link rel="stylesheet" href="css/app.css">`, and
   `<script type="module" src="js/main.js"></script>` at the end of `<body>`.
2. **Remove every inline `onclick=` / `onblur=` / `onfocus=` / `onchange=` /
   `onkeydown=` attribute** from the HTML. Re-attach them in the owning module with
   `addEventListener` inside an exported `init()` function that `main.js` calls
   (e.g. `initSettingsView()`, `initRosterView()`, `initRaceView()`, `initOverlays()`).
   This is required — module functions aren't global, so inline handlers would break.
3. `state.js` exports a single mutable `state` object and `PLAYER_COLORS`; all modules
   import from it. No module keeps private copies of state.
4. `ws.js` owns `dispatch()`; it imports the update functions it calls. Circular imports
   are avoided because `state.js` and `util.js` import nothing app-local.
5. Move code verbatim wherever possible. Do not rename functions, change coordinates,
   or "improve" logic during this phase — the Phase 1–3 fixes are already in.
6. The kiosk targets Chromium on Raspberry Pi OS Bookworm — full ES-module support;
   no transpilation or bundler.

### 4.3 Verification

- Diff test: `GET /api/state` before/after must be identical; every user flow from the
  README "Using the app" section must work: nav icons, roster tab-cycling and blur-save,
  every settings control, start/stop, countdown, winner modal dismiss, WS reconnect
  (restart the server mid-session and confirm the UI recovers).
- `git mv`-style history isn't needed; one commit titled
  `Split index.html into ES modules (no behavior change)`.

---

## Phase 5 — Small enhancements (optional, in priority order)

1. **Keyboard shortcuts** (`main.js`): `1`/`2`/`3` → navigate RACE/ROSTER/SETTINGS,
   `Space` → start/stop toggle, `m` → mock-mode toggle (`/api/command {cmd:'mock'}`).
   Ignore keys when `document.activeElement` is an `<input>`/`<select>`. This restores
   the C++ Cmd+1/2/3 behavior and makes mock mode reachable without curl.
2. **False-start indicator**: the `false_start` WS message currently only logs to the
   console (index.html `dispatch`, `case 'false_start'`). Show a brief red flash of the
   offending racer's row: add CSS class `.false-start { animation: fs-flash 1s; }` with a
   keyframe flashing `box-shadow` red, apply to `row-bg-{racerId}`, remove on
   `animationend`.
3. **Mock-mode visibility**: add a small "MOCK" badge (absolute, top-center, in the
   existing label style) toggled by tracking mock state client-side when the `m` shortcut
   is used. (The Arduino `M:` confirmation is currently only logged server-side; if you
   want it authoritative, broadcast a `mock_mode` message from the `'M'` case in
   SerialReader and handle it in `dispatch()`.)
4. **Bind to localhost for the Electron build**: in `server.js`, respect
   `HOST=127.0.0.1` env var in `server.listen(PORT, HOST)`; set it in
   `electron-main.js` before `require('./server.js')`. Keep default `0.0.0.0` for the
   Pi/kiosk deployment where a separate Chromium connects. Document in README.
5. **Roster input `maxlength="40"`** to match the server-side cap from 1.2.

---

## Out of scope (do not do)

- No framework adoption (React/Vue/etc.), no bundler, no TypeScript.
- No changes to the serial protocol, tick math, or speed-averaging logic in
  `PlayerData.js` — it deliberately mirrors the C++ original.
- No visual redesign; all 1920×1080 coordinates stay exactly as annotated.
