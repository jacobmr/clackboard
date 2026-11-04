#!/bin/bash
# Turn a 64-bit Raspberry Pi OS Lite (Pi 3/4/5) into a Clackboard TV: Chromium
# full screen on /player under the cage Wayland kiosk, started at boot.
# Plays the board and video items, with sound.
#
# Usage, on the Pi: sudo ./install.sh [server]
set -euo pipefail

SERVER="${1:-https://www.clackboard.fyi}"
USER_PI="${SUDO_USER:-jmr}"

apt-get update
apt-get install -y --no-install-recommends cage chromium fonts-dejavu-core

cat > /etc/systemd/system/clackboard-kiosk.service <<UNIT
[Unit]
Description=Clackboard TV (Chromium kiosk)
After=network-online.target systemd-user-sessions.service
Wants=network-online.target
Conflicts=getty@tty1.service

[Service]
User=$USER_PI
PAMName=login
TTYPath=/dev/tty1
StandardInput=tty
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user
Environment=XDG_SESSION_TYPE=wayland
ExecStart=/usr/bin/cage -- /usr/bin/chromium --kiosk --ozone-platform=wayland \\
  --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \\
  --disable-features=Translate --password-store=basic \\
  "$SERVER/player?kiosk"
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

usermod -aG video,render,input,audio "$USER_PI"
systemctl disable --now getty@tty1.service || true
systemctl daemon-reload
systemctl enable clackboard-kiosk.service
systemctl restart clackboard-kiosk.service
echo "Installed. The TV should show the pairing code within a minute."
