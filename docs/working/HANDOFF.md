# Clackboard handoff

Last updated 2026-10-27 (re-checked; no code changes since 2026-10-26. Session ended by JMR; he has enhancements to suggest).

## START HERE

- Nothing is broken or half-done. `main` is pushed and clean. There are no open PRs.
- **Waiting on JMR:** his list of enhancements, given at the start of the next session.
  The Questions doc has nothing open (see "Decisions" below).
- Production works end to end, verified 2026-10-26: JMR paired the Pi on the TV, sent a
  message from his phone, and confirmed that the flaps and the clicks work ("clicks were perfect").

## The next work, in order

1. **JMR's enhancements.** Ask for the list first. Each decision goes in the Questions doc,
   not in chat.
2. *(Optional, ~1 min.)* Make the bare `clackboard.fyi` the primary domain instead of `www.`
   (Vercel → clackboard → Settings → Domains). The pairing text uses the request host
   (`src/app/api/player/route.ts`), so the TV would then show `CLACKBOARD.FYI/APP`.
   Then change `SERVER` in `pi/player/clackboard_player.py:25` and `pi/player/install.sh:6`
   to the bare domain. Python's urllib does not follow a 308 redirect on POST, so the Pi
   must use the primary host.
3. *(Optional, 1–2 days.)* ESP32 small-display client (Q2 lists it as optional). A CYD board
   can poll `GET /api/player?token=…&format=grid`, the same endpoint the Pi uses.
4. Dropped by JMR on 2026-10-26: the Home Assistant pull feed (the school HA is on Tailscale,
   so Vercel can't reach it). Do not resume it unless he asks. The push via `rest_command`
   is documented in the README.

## What shipped this session (2026-10-25 to 2026-10-26, straight to `main`)

| Commit | What it did |
|---|---|
| fec5f23, 366a356 | `pi/make-sd.sh`: writes Raspberry Pi OS Lite armhf (Trixie) to an SD card and sets up cloud-init `user-data` and `network-config` (Wi-Fi, SSH key, hostname `clackboard`). Forces the eject when Spotlight holds the card. |
| 53488b9 | `GET /api/player?format=grid` returns each message already laid out as rows of cells, so non-browser players don't port `layout()`. Also adds the first Pi player. |
| 40e9c9f, 344fb37 | Pi player (`pi/player/clackboard_player.py`): draws into `/dev/fb0` (RGB565 through mmap, writing only changed cells), polls every 4 s, rotates the playlist, and plays flap clicks over HDMI (same recipe as the web board). `pi/player/install.sh` installs it as `clackboard.service`. |
| e171b54 | The Pi player's default server is `https://www.clackboard.fyi`. |
| 1676896 | `createDevice` (`src/lib/db.ts:95`) deletes unpaired screens that haven't polled for 24 h. |

Not code: JMR registered `clackboard.fyi` (DNS on Cloudflare, attached to the Vercel project).
`ADMIN_PASSWORD` was changed to a short passphrase that JMR chose, in both `secrets.env.enc`
and Vercel production.

## Corrections

- Raspberry Pi OS Trixie uses **cloud-init** (`user-data`, `network-config` on the boot
  partition), not `firstrun.sh` or `wpa_supplicant.conf`.
- **SDL kmsdrm showed nothing on the TV**, even with Mesa EGL installed: the service ran and
  the DRM plane was active, but the screen was blank. Writing to `/dev/fb0` works. Mesa
  packages (`libegl1 libegl-mesa0 libgles2 libgbm1 libgl1-mesa-dri`) are still on the Pi but
  are no longer needed; `install.sh` no longer installs them. `CLACKBOARD_DISPLAY=sdl` keeps
  the old path for experiments.
- The first version used a 512-frame audio buffer, which caused ALSA underruns on the Zero W.
  It is now 2048, with no underruns in a 30 s check.

## Unverified, ordered by consequence

1. **`secrets.env.enc` exists only on this Mac** (`~/dev/clackboard`, gitignored because the
   repo is public). It is not in the master catalog on desk. If this Mac is lost, the secrets
   must be rebuilt from Vercel/Turso. Add them to `/data/dev/inventory/secrets/master-catalog.enc.yaml`.
2. The login rate limit (`src/app/api/login/route.ts`, 10 fails per 15 min per IP) is kept in
   memory on each serverless instance. With the short password, that is weak protection.
3. **The player can't put the console in graphics mode:** `KDSETMODE` on `/dev/tty1` fails
   with EACCES (`clackboard_player.py`, `text_mode_off`). It has no visible effect today,
   because getty is disabled on tty1 and `vt.global_cursor_default=0` is set. Kernel messages
   could still draw over the board.
4. The Pi player hasn't been tested with the light theme, with sizes other than 6×22, or with
   a long offline period. The flap animation is reported fine at 6×22; full-board changes at
   larger sizes may stutter on the single-core CPU.
5. Older smart-TV browsers on `/player` are still untested (ResizeObserver and similar features).

## Live state

- Web: https://www.clackboard.fyi (apex redirects with a 308); `clackboard.vercel.app` still
  works. Vercel project `clackboard`, team `huddlehealth`; pushes to `main` deploy automatically.
- DB: Turso `clackboard` (aws-us-east-1).
- Pi: Pi Zero W, host `clackboard.local` (192.168.8.192 on Wi-Fi `6DP`), user `jmr`, SSH key
  login only, passwordless sudo. Raspberry Pi OS 13 Trixie armhf. Paired as screen
  **"38W"**. Service `clackboard.service` (`/opt/clackboard/clackboard_player.py`), about 6%
  CPU and 45 MB RSS when idle. Device token in `~/.config/clackboard/device.json` on the Pi.
- **Pi offline as of 2026-10-27:** `/api/screens` showed "38W" last polled about 83 min before the
  check, and `clackboard.local` did not resolve from the Mac. It may just be unplugged or the Mac
  on another network. If the board is blank, check power and Wi-Fi `6DP` first.
  To see when it last polled without SSH: `GET /api/screens` with the Bearer `API_TOKEN` and read `lastSeen`.
- Questions doc: https://claude.ai/artifact/4AUW1o4cr1AhM6bzEDtbzt. Q1–Q7 answered; nothing open.

## Standing rules worth not relearning

- Deploy to the Pi: `scp pi/player/*.py pi/player/*.sh jmr@clackboard.local:~/clackboard-player/`
  then `ssh jmr@clackboard.local 'sudo ~/clackboard-player/install.sh'`. Delete
  `pi/player/__pycache__` first, or `scp` fails. A restart takes about 15 s.
- The Zero W is slow: `apt` installs take 5+ min and SSH commands can block for over 2 min.
  Run long jobs in the background.
- The Zero W uses 2.4 GHz Wi-Fi only. Power goes in the outer micro-USB port labelled PWR.
  Shut down with `sudo shutdown -h now` before unplugging.
- HDMI audio needs the user in the `audio` group and `AUDIODEV=hdmi:CARD=vc4hdmi,DEV=0`.
- Vercel CLI: `npx -y vercel@50.4.0 … --scope huddlehealth`. Pipe secret values from SOPS
  into `vercel env add`; never pass them as arguments.
- Never sign in to production with JMR's password from a tool; he signs in himself.
