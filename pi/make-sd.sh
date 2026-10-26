#!/bin/bash
# Write Raspberry Pi OS Lite (32-bit) to an SD card and set it up to boot
# headless: Wi-Fi, SSH key login, hostname. Works on a Pi Zero W (ARMv6).
#
# Usage: pi/make-sd.sh [diskN]      (macOS; asks for sudo to write the card)
set -euo pipefail

IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_armhf_latest"
CACHE="$HOME/Downloads/clackboard-pi"
HOSTNAME_PI="${HOSTNAME_PI:-clackboard}"
USER_PI="${USER_PI:-$(whoami)}"
PUBKEY="${PUBKEY:-$HOME/.ssh/id_ed25519.pub}"

die() { echo "error: $*" >&2; exit 1; }

# 1. Pick the card. Only removable media under 512 GB, never the boot disk.
DISK="${1:-}"
if [ -z "$DISK" ]; then
  DISK=$(system_profiler SPCardReaderDataType 2>/dev/null | awk '/BSD Name: disk[0-9]+$/ {print $3; exit}')
fi
[ -n "$DISK" ] || die "no SD card found; pass the disk, e.g. pi/make-sd.sh disk4"
INFO=$(diskutil info "$DISK") || die "$DISK not found"
echo "$INFO" | grep -qE 'Removable Media: +(Removable|Yes)|Protocol: +(Secure Digital|USB)' \
  || die "$DISK is not removable media"
BYTES=$(echo "$INFO" | awk -F'[(]' '/Disk Size/ {split($2,a," "); print a[1]; exit}')
[ "${BYTES:-0}" -lt 512000000000 ] || die "$DISK is larger than 512 GB; refusing"
[ -f "$PUBKEY" ] || die "no SSH public key at $PUBKEY"

# 2. Download the image once and check its SHA-256.
mkdir -p "$CACHE"
URL=$(curl -fsIL -o /dev/null -w '%{url_effective}' "$IMAGE_URL")
IMG="$CACHE/$(basename "$URL")"
if [ ! -f "$IMG" ]; then
  echo "Downloading $(basename "$URL") (about 500 MB)..."
  curl -fL --progress-bar -o "$IMG.part" "$URL" && mv "$IMG.part" "$IMG"
fi
WANT=$(curl -fsL "$URL.sha256" | awk '{print $1}')
GOT=$(shasum -a 256 "$IMG" | awk '{print $1}')
[ "$WANT" = "$GOT" ] || die "checksum mismatch for $IMG; delete it and re-run"

# 3. Wi-Fi details. The Zero W only sees 2.4 GHz networks.
read -r -p "Wi-Fi name (2.4 GHz): " SSID
read -r -s -p "Wi-Fi password: " WIFI_PASS; echo
read -r -p "Wi-Fi country code [CR]: " COUNTRY; COUNTRY="${COUNTRY:-CR}"
read -r -p "Time zone [America/Costa_Rica]: " TZ_PI; TZ_PI="${TZ_PI:-America/Costa_Rica}"
[ -n "$SSID" ] && [ -n "$WIFI_PASS" ] || die "Wi-Fi name and password are required"

# 4. Last chance.
echo
echo "About to ERASE /dev/$DISK ($(echo "$INFO" | awk -F': +' '/Media Name/ {print $2; exit}'), $((BYTES / 1000000000)) GB)"
echo "and write $(basename "$IMG") as host '$HOSTNAME_PI', user '$USER_PI'."
read -r -p "Type ERASE to continue: " OK
[ "$OK" = "ERASE" ] || die "cancelled"

# 5. Write it. The raw device (rdisk) is much faster than disk.
diskutil unmountDisk "/dev/$DISK"
echo "Writing (5 to 10 minutes)..."
xz -dc "$IMG" | sudo dd of="/dev/r$DISK" bs=4m
sync

# 6. Mount the boot partition and write the first-boot config (cloud-init).
diskutil mountDisk "/dev/$DISK" >/dev/null || true
BOOT=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -d /Volumes/bootfs ] && BOOT=/Volumes/bootfs && break
  sleep 1
done
[ -n "$BOOT" ] || die "boot partition did not mount; re-insert the card and re-run"
[ -f "$BOOT/user-data" ] || die "this image has no cloud-init user-data; it needs Raspberry Pi OS Trixie or newer"

# YAML single quotes: the only escape is '' for a literal '.
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/''/g")"; }

cat > "$BOOT/user-data" <<EOF
#cloud-config
hostname: $HOSTNAME_PI
manage_etc_hosts: true
timezone: $TZ_PI

users:
  - name: $USER_PI
    groups: users,adm,sudo,video,input,render
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - $(cat "$PUBKEY")
    sudo: ALL=(ALL) NOPASSWD:ALL

enable_ssh: true
EOF

cat > "$BOOT/network-config" <<EOF
network:
  version: 2
  wifis:
    renderer: NetworkManager
    wlan0:
      dhcp4: true
      regulatory-domain: "$COUNTRY"
      access-points:
        $(q "$SSID"):
          password: $(q "$WIFI_PASS")
      optional: true
EOF
unset WIFI_PASS

sync
diskutil eject "/dev/$DISK"
echo
echo "Done. Put the card in the Pi, plug in power, wait 3 to 5 minutes, then:"
echo "  ssh $USER_PI@$HOSTNAME_PI.local"
