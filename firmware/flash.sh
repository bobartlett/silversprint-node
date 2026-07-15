#!/usr/bin/env bash
# Reflash the SilverSprint Arduino (Uno R3) with the ss_basic firmware.
#
#   ./firmware/flash.sh [port]     port auto-detected if omitted
#   npm run flash:firmware
#
# When to use: the Settings view shows firmware "Unknown", or starts fail
# with "START FAILED — CHECK ARDUINO CONNECTION" even after replugging the
# board. That means the sketch on the ATmega died; this puts it back.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# The server holds the serial port exclusively — stop it first.
if pgrep -f "node server.js" > /dev/null 2>&1; then
  echo "Stopping running SilverSprint server (it holds the serial port)…"
  pkill -f "node server.js" || true
  sleep 1
fi

# Find arduino-cli: PATH first, then the copy bundled inside Arduino IDE 2.
CLI="$(command -v arduino-cli || true)"
if [ -z "$CLI" ]; then
  BUNDLED="/Applications/Arduino IDE.app/Contents/Resources/app/lib/backend/resources/arduino-cli"
  [ -x "$BUNDLED" ] && CLI="$BUNDLED"
fi
if [ -z "$CLI" ]; then
  echo "arduino-cli not found. Install Arduino IDE 2, or: brew install arduino-cli" >&2
  exit 1
fi

"$CLI" core list 2>/dev/null | grep -q '^arduino:avr' || "$CLI" core install arduino:avr

PORT="${1:-$(ls /dev/cu.usbmodem* /dev/cu.usbserial* /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -1)}"
if [ -z "$PORT" ]; then
  echo "No Arduino serial port found — is the board plugged in?" >&2
  exit 1
fi

echo "Compiling ss_basic…"
"$CLI" compile -b arduino:avr:uno "$DIR/ss_basic"
echo "Uploading to $PORT…"
"$CLI" upload -b arduino:avr:uno -p "$PORT" "$DIR/ss_basic"
echo
echo "Done. Restart the server (npm start) and confirm the Settings view"
echo "shows firmware SS_v0.1.7."
