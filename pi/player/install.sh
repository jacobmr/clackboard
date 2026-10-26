#!/bin/bash
# Install the Clackboard player on a Pi as a service that starts at boot.
# Run on the Pi: sudo ./install.sh [server-url]
set -euo pipefail

SERVER="${1:-https://clackboard.vercel.app}"
RUN_USER="${SUDO_USER:-$(whoami)}"
HERE="$(cd "$(dirname "$0")" && pwd)"

apt-get install -y --no-install-recommends python3-pygame
install -D -m 755 "$HERE/clackboard_player.py" /opt/clackboard/clackboard_player.py

cat > /etc/systemd/system/clackboard.service <<EOF
[Unit]
Description=Clackboard split-flap player
After=network-online.target
Wants=network-online.target

[Service]
User=$RUN_USER
SupplementaryGroups=video tty audio
Environment=CLACKBOARD_SERVER=$SERVER
AmbientCapabilities=CAP_SYS_TTY_CONFIG
Environment=AUDIODEV=hdmi:CARD=vc4hdmi,DEV=0
ExecStart=/usr/bin/python3 -u /opt/clackboard/clackboard_player.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# The board owns the TV: no login prompt on it, and the screen never blanks.
systemctl disable --now getty@tty1.service || true
for opt in consoleblank=0 vt.global_cursor_default=0; do
  grep -q "$opt" /boot/firmware/cmdline.txt || sed -i "1 s/\$/ $opt/" /boot/firmware/cmdline.txt
done

systemctl daemon-reload
systemctl enable --now clackboard.service
echo "Installed. Logs: journalctl -u clackboard -f"
