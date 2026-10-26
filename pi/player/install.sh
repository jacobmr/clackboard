#!/bin/bash
# Install the Clackboard player on a Pi as a service that starts at boot.
# Run on the Pi: sudo ./install.sh [server-url]
set -euo pipefail

SERVER="${1:-https://clackboard.vercel.app}"
RUN_USER="${SUDO_USER:-$(whoami)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# SDL draws through EGL on KMS, so it needs the Mesa GL stack.
apt-get install -y --no-install-recommends python3-pygame libegl1 libegl-mesa0 libgles2 libgbm1 libgl1-mesa-dri
install -D -m 755 "$HERE/clackboard_player.py" /opt/clackboard/clackboard_player.py

cat > /etc/systemd/system/clackboard.service <<EOF
[Unit]
Description=Clackboard split-flap player
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
SupplementaryGroups=video render input
Environment=CLACKBOARD_SERVER=$SERVER
Environment=SDL_VIDEODRIVER=kmsdrm
ExecStart=/usr/bin/python3 -u /opt/clackboard/clackboard_player.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# The board owns the TV: no login prompt on it, and the screen never blanks.
systemctl disable --now getty@tty1.service || true
grep -q consoleblank=0 /boot/firmware/cmdline.txt || sed -i '1 s/$/ consoleblank=0/' /boot/firmware/cmdline.txt

systemctl daemon-reload
systemctl enable --now clackboard.service
echo "Installed. Logs: journalctl -u clackboard -f"
