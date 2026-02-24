#!/usr/bin/env bash
# SilverSprints Raspberry Pi setup script.
# Run once as the 'pi' user (with sudo access) on a fresh Raspberry Pi OS install.
# Tested on: Raspberry Pi OS Bookworm (64-bit) with LXDE desktop.
#
# Usage:
#   chmod +x setup.sh && ./setup.sh

set -euo pipefail

INSTALL_DIR="$HOME/silversprint-node"
SERVICE_NAME="silversprint"

echo "=== SilverSprint Raspberry Pi Setup ==="
echo

# ── 1. System packages ──────────────────────────────────────────────────────
echo "[1/6] Installing system packages…"
sudo apt-get update -q
sudo apt-get install -y \
    build-essential \
    unclutter \
    chromium-browser \
    xdotool

# ── 2. Node.js (LTS via NodeSource) ─────────────────────────────────────────
echo "[2/6] Installing Node.js LTS…"
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
else
    echo "  Node.js $(node --version) already installed."
fi

# ── 3. Serial port permissions ───────────────────────────────────────────────
echo "[3/6] Adding $USER to dialout group (required for /dev/ttyACM* access)…"
if ! groups "$USER" | grep -q dialout; then
    sudo usermod -aG dialout "$USER"
    echo "  Added. You must log out and back in (or reboot) for this to take effect."
else
    echo "  Already in dialout group."
fi

# ── 4. npm install ───────────────────────────────────────────────────────────
echo "[4/6] Installing Node.js dependencies in $INSTALL_DIR…"
if [ ! -d "$INSTALL_DIR" ]; then
    echo "  ERROR: $INSTALL_DIR not found."
    echo "  Copy the silversprint-node directory to $INSTALL_DIR first."
    exit 1
fi
cd "$INSTALL_DIR"
npm install --omit=dev

# ── 5. systemd service ───────────────────────────────────────────────────────
echo "[5/6] Installing systemd service…"
# Patch User= and WorkingDirectory= to match current user / directory
sed "s|User=pi|User=$USER|g; s|WorkingDirectory=/home/pi/silversprint-node|WorkingDirectory=$INSTALL_DIR|g" \
    "$INSTALL_DIR/deploy/silversprint.service" \
    | sudo tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start  "$SERVICE_NAME"
echo "  Service status:"
sudo systemctl is-active "$SERVICE_NAME" && echo "  ✓ Running" || echo "  ✗ Not running — check: journalctl -u $SERVICE_NAME"

# ── 6. Chromium kiosk autostart ─────────────────────────────────────────────
echo "[6/6] Installing Chromium kiosk autostart…"
AUTOSTART_DIR="$HOME/.config/lxsession/LXDE-pi"
mkdir -p "$AUTOSTART_DIR"
cp "$INSTALL_DIR/deploy/autostart" "$AUTOSTART_DIR/autostart"
echo "  Autostart written to $AUTOSTART_DIR/autostart"

echo
echo "=== Setup complete! ==="
echo
echo "Next steps:"
echo "  1. Reboot: sudo reboot"
echo "  2. After reboot, Chromium will open SilverSprint automatically in kiosk mode."
echo "  3. Connect the Arduino — it will be detected automatically."
echo
echo "Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME    # Node.js server status"
echo "  journalctl -fu $SERVICE_NAME           # Live server logs"
echo "  sudo systemctl restart $SERVICE_NAME   # Restart after code changes"
echo
echo "To update the app after code changes:"
echo "  cd $INSTALL_DIR && npm install --omit=dev"
echo "  sudo systemctl restart $SERVICE_NAME"
