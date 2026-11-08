# Clackboard handoff

Last updated 2026-11-08.

## START HERE

- `main` is pushed and clean. Last code commit `784f5ca`; later commits are docs only. No open PRs. Vercel serves `784f5ca` (checked
  2026-11-05: `POST /api/screens/x/skip` returns 401, so the new route is live).
- The Pi 4 TV works: board, flap sound, and the Vimeo demo video with sound. JMR confirmed
  "working" on 2026-11-05.
- Pause works on the real TV (JMR, 2026-11-08). Skip hasn't been confirmed on the TV yet.
- Questions doc: Q1–Q10 answered (Q10 = (b), passwordless "the TV is the key"). Nothing open.

## The next work, in order

1. If JMR reports Skip/Pause problems on the TV: the browser logic is in
   `src/app/player/page.tsx` (`nextIndex`, and the three effects after "Rotate through the
   playlist"). The server side is `skipScreen` in `src/lib/db.ts` and
   `src/app/api/screens/[id]/skip/route.ts`.
2. Deploy the current Pi player to the Zero W ("38W") when it is online (the command is under
   Standing rules). That brings boot sign-in codes plus Skip/Pause to it.
3. *(Offered to JMR, not asked for yet.)* Delete the unused `ADMIN_PASSWORD` env var from
   Vercel and from `secrets.env.enc`.
4. *(Offered, not asked for.)* After boot, show the sign-in code in a corner overlay instead of
   a full-screen message for 2 minutes. The text is built in `src/app/api/player/route.ts`
   (`signin`).
5. *(Optional, ~1 min.)* Make bare `clackboard.fyi` the primary domain. Then change `SERVER`
   in `pi/player/clackboard_player.py`, `pi/player/install.sh` and `pi/kiosk/install.sh`
   (Python's urllib does not follow a 308 on POST).
6. *(Optional, 1–2 days.)* ESP32 client polling `GET /api/player?token=…&format=grid`.
7. Dropped by JMR on 2026-10-26: the Home Assistant pull feed. Do not resume unless he asks.

## What shipped 2026-11-04 to 2026-11-05 (straight to `main`)

| Commit | What it did |
|---|---|
| 77900ab | Kiosk: `/etc/asound.conf` points ALSA at `hdmi:CARD=vc4hdmi0,DEV=0`. Before this, Chromium sent sound to the headphone jack. |
| e9832fa | **No passwords.** The `/api/login` route was deleted. You sign in by entering a code from the TV: after each boot, a paired screen shows a sign-in code (plus a QR code) for 2 min (`LOGIN_MS`, `src/lib/db.ts`). `redeemLoginCode` uses the code once and starts a 1-year session cookie. Pairing a new screen while signed out creates a new account (`newOwner`). Rate limit: `src/lib/ratelimit.ts`. |
| 646629e | Video item gets a Size option (100/75/50/33 % of the screen). |
| 3c456dc | Fix: the playlist "+" buttons never appended an item (`edit` in `src/app/app/page.tsx`). |
| 3acb1d9 | `API_OWNER` env var sets the account that `API_TOKEN` acts as (`ownerFor`, `src/lib/auth.ts`). Set in Vercel to JMR's account. |
| 05d0c3f | Kiosk: `video=HDMI-A-1:1920x1080@60` in `cmdline.txt`. At 4K the video choked. |
| de1565e | Kiosk: Chromium `--disable-accelerated-video-decode`. The Pi 4 hardware decoder froze video at 0:09 (stuck after 144 frames). With software decoding, the demo played 76 s+ with audio. |
| 784f5ca | **Skip and Pause** buttons in `/app`. Skip bumps `screens.skips`, and players advance when the number changes. `paused` holds the current item. In the browser player, pausing on a video moves to the next message and holds it. Both the browser player and the Pi Zero player support them. API: `POST /api/screens/<id>/skip`, `PATCH /api/screens/<id> {"paused": bool}`. |

## Corrections

- The 2026-11-04 handoff said `ADMIN_PASSWORD` protects the app. It no longer does: there are
  no passwords since e9832fa. The env var is still set but nothing reads it.
- "Tap the TV for sound" (old app hint) was wrong for the Pi 4. The kiosk (`?kiosk`) plays sound
  without a tap. The hint now says this per device.
- The TV's old "TV" screen row disappeared 2026-11-04 (cause unknown). JMR's phone paired the
  Pi 4 again as screen "636" in a new account. 38W was moved to that account, and `API_OWNER`
  points at it.

## Unverified, ordered by consequence

1. **Skip on the real Pi 4 TV.** Pause works on the TV (JMR confirmed it on 2026-11-08). Skip and
   Resume were tested only on a local copy in Chrome.
2. **`secrets.env.enc` exists only on this Mac** (gitignored; the repo is public). It is not in
   the master catalog. Add it to `/data/dev/inventory/secrets/master-catalog.enc.yaml`.
3. **The Zero W (38W) runs an older player.** The 2026-11-04 background deploy printed nothing.
   38W was last seen 2026-11-03. The player now on it may not have the boot-flag change or
   Skip/Pause.
4. Whether cage (the kiosk) picks up a TV plugged in after boot is unverified. A power-cycle
   works.
5. The rate limit (`src/lib/ratelimit.ts`, 10 fails per 15 min per IP) lives in memory per
   serverless instance. Sign-in codes are 6 characters and live for 2 min, so the exposure is
   small, but it is not a global limit.
6. The Pi Zero player hasn't been tested with the light theme, with non-6×22 sizes, or with a
   long time offline. `KDSETMODE` on tty1 still fails with EACCES; no visible effect today.

## Live state

- Web: https://www.clackboard.fyi (the apex redirects with a 308). Vercel project `clackboard`,
  team `huddlehealth`. Pushes to `main` deploy in about 45 s.
- DB: Turso `clackboard` (aws-us-east-1). New columns since 2026-11-03: `login_code`,
  `login_until`, `skips`, `paused`. They are added by `migrate()` in `src/lib/db.ts`.
- Pi 4 TV: host `clackboard-tv.local`, user `jmr`, Raspberry Pi OS Trixie arm64, in Portland on
  Wi-Fi `6DP`. Service `clackboard-kiosk.service`: cage + Chromium on `/player?kiosk`, 1080p,
  HDMI 0 audio, software video decoding. Paired as screen **"636"**.
  - Playlist on 2026-11-05: text 20 s, time 20 s, video 60 s (size 50), video 600 s (size 50).
    Both videos are the Vimeo demo; the second one is a duplicate JMR may want to remove.
  - The Chromium remote debugging flag is removed.
- Pi Zero W: host `clackboard.local`, screen **"38W"**, `clackboard.service`. Last seen
  2026-11-03.
- Questions doc: https://claude.ai/artifact/4AUW1o4cr1AhM6bzEDtbzt.

## Standing rules worth not relearning

- Deploy to the Zero W: delete `pi/player/__pycache__`, then
  `scp pi/player/*.py pi/player/*.sh jmr@clackboard.local:~/clackboard-player/`, then
  `ssh jmr@clackboard.local 'sudo ~/clackboard-player/install.sh'`. It is slow; run it in the
  background.
- Deploy to the Pi 4: copy `pi/kiosk/install.sh` to the Pi and run it with sudo. After a web
  deploy, run `sudo systemctl restart clackboard-kiosk`, or the TV keeps the old JS. A restart
  shows the sign-in screen for 2 min.
- **Debug the Pi 4's Chromium:**
  1. Temporarily add `--remote-debugging-port=9222` to the kiosk service.
  2. Run `ssh -f -N -L 9222:localhost:9222 jmr@clackboard-tv.local`.
  3. Drive it with Node WebSocket scripts.
  4. Remove the flag afterward.
- **Local test with no account:**
  1. Run `TURSO_DATABASE_URL=file:<tmp>.db API_TOKEN=t SESSION_SECRET=s pnpm next dev -p 3999`.
  2. Pair with `Authorization: Bearer t`, using the pair code from `sqlite3`.
  3. See the project skill `clackboard-local-test`.
- After deleting a route, run `rm -rf .next/types` before `tsc`.
- In zsh, inline Python containing `$P[...]` breaks. Use heredocs or script files.
- Vercel CLI: `npx -y vercel@50.4.0 … --scope huddlehealth`. Pipe secret values from SOPS into
  `vercel env add`; never pass them as arguments.
- Never sign in to production with JMR's credentials from a tool.
