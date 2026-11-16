#!/bin/bash
# Turn a 64-bit Raspberry Pi OS Lite (Pi 3/4/5) into a Clackboard TV: Chromium
# full screen on /player under the cage Wayland kiosk, started at boot.
# Plays the board and video items, with sound.
#
# Usage, on the Pi: sudo ./install.sh [server]
set -euo pipefail

SERVER="${1:-https://www.clackboard.fyi}"
USER_PI="${SUDO_USER:-jmr}"

HERE="$(cd "$(dirname "$0")" && pwd)"
[ -f "$HERE/wifi_setup.py" ] || { echo "wifi_setup.py must sit next to install.sh" >&2; exit 1; }

apt-get update
apt-get install -y --no-install-recommends cage chromium fonts-dejavu-core dnsmasq-base

# Wi-Fi setup: with no internet for 90 s, the Pi starts its own network
# "Clackboard-Setup" and the TV shows how to pick the venue's Wi-Fi from a phone.
install -D -m 755 "$HERE/wifi_setup.py" /opt/clackboard/wifi_setup.py
mkdir -p /etc/NetworkManager/dnsmasq-shared.d
# Every name resolves to the Pi while it runs the setup network, so phones open
# the setup page by themselves.
echo "address=/#/10.42.0.1" > /etc/NetworkManager/dnsmasq-shared.d/clackboard-captive.conf
cat > /etc/systemd/system/clackboard-wifi.service <<UNIT
[Unit]
Description=Clackboard Wi-Fi setup (own network when offline)
After=NetworkManager.service
Wants=NetworkManager.service

[Service]
Environment=CLACKBOARD_SERVER=$SERVER
ExecStart=/usr/bin/python3 /opt/clackboard/wifi_setup.py
# The kiosk starts after this; wait until the start page answers.
ExecStartPost=/bin/sh -c 'for i in \$(seq 50); do python3 -c "import urllib.request as u; u.urlopen(\"http://127.0.0.1:8080/status.json\", timeout=1)" 2>/dev/null && exit 0; sleep 0.2; done'
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/clackboard-kiosk.service <<UNIT
[Unit]
Description=Clackboard TV (Chromium kiosk)
# The start page (127.0.0.1:8080) opens the board when online and shows the
# Wi-Fi steps when not, so the kiosk no longer waits for the network.
After=clackboard-wifi.service systemd-user-sessions.service
Wants=clackboard-wifi.service
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
# --disable-accelerated-video-decode: the Pi 4's hardware decoder path in
# Chromium freezes after 144 frames (Vimeo stalled at 0:09 every time).
# Software decoding keeps up at 720p.
ExecStart=/usr/bin/cage -- /usr/bin/chromium --kiosk --ozone-platform=wayland \\
  --noerrdialogs --disable-infobars --no-first-run --disable-session-crashed-bubble \\
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \\
  --disable-features=Translate --disable-accelerated-video-decode --password-store=basic \\
  http://127.0.0.1:8080/
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

# Chromium plays through ALSA's default device, which is the headphone jack.
# Send it to the TV (HDMI 0, the port next to USB-C) instead.
cat > /etc/asound.conf <<ALSA
pcm.!default { type plug slave.pcm "hdmi:CARD=vc4hdmi0,DEV=0" }
ctl.!default { type hw card vc4hdmi0 }
ALSA

# 4K output is too much for a Pi 4 with Chromium and video: force 1080p.
CMDLINE=/boot/firmware/cmdline.txt
grep -q "video=HDMI-A-1" "$CMDLINE" || sed -i '1 s/$/ video=HDMI-A-1:1920x1080@60/' "$CMDLINE"

usermod -aG video,render,input,audio "$USER_PI"
systemctl disable --now getty@tty1.service || true
systemctl daemon-reload
systemctl enable clackboard-wifi.service clackboard-kiosk.service
systemctl restart clackboard-wifi.service
systemctl restart clackboard-kiosk.service
echo "Installed. The TV should show the pairing code within a minute."
