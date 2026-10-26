# Clackboard

A split-flap message board for any screen. Open `/player` on a TV, pair it
from your phone, and send messages, weather, calendar events and Home
Assistant states to it. Self-hosted and single-owner.

## Run locally

```bash
pnpm install
ADMIN_PASSWORD=... API_TOKEN=... SESSION_SECRET=... pnpm dev
```

1. Open http://localhost:3000/player on the screen. It shows a 6-character code.
2. Open http://localhost:3000/app on your phone, sign in with `ADMIN_PASSWORD`, enter the code.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | yes | Sign-in for the phone app |
| `API_TOKEN` | yes | Bearer token for the HTTP API |
| `SESSION_SECRET` | yes | Signs the session cookie (any long random string) |
| `TURSO_DATABASE_URL` | no | libSQL/Turso URL; defaults to a local `clackboard.db` file |
| `TURSO_AUTH_TOKEN` | no | Turso token |
| `HA_URL`, `HA_TOKEN` | no | Home Assistant base URL and long-lived access token |
| `DEFAULT_TIMEZONE` | no | IANA zone for time and calendar feeds (default `America/Los_Angeles`) |

## Sending messages

```bash
curl -X POST https://your-host/api/screens/all/send \
  -H "Authorization: Bearer $API_TOKEN" -H "content-type: application/json" \
  -d '{"text": "{green} DINNER AT 7 {green}", "seconds": 600}'
```

Use a screen id instead of `all` for one screen. `"seconds": 0` keeps the
message up until `DELETE /api/screens/<id>/send`. Colors: `{red}` `{orange}`
`{yellow}` `{green}` `{blue}` `{violet}` `{white}`.

### From Home Assistant

The Home Assistant playlist item reads states from `HA_URL`, so HA must be
reachable from where Clackboard runs. If it is not (HA behind Tailscale, say),
push instead; HA only needs outbound access:

```yaml
rest_command:
  clackboard:
    url: https://your-host/api/screens/all/send
    method: post
    headers:
      authorization: !secret clackboard_bearer   # "Bearer <API_TOKEN>"
    content_type: application/json
    payload: '{"text": "{{ text }}", "seconds": {{ seconds | default(300) }}}'
```

## Feeds

- **Time** and **weather** ([Open-Meteo](https://open-meteo.com), no key)
- **Calendar**: any iCal URL. For Google Calendar use Settings > your calendar > "Secret address in iCal format".
- **Home Assistant**: list entity ids and labels; values line up in columns.

## Raspberry Pi player

Any TV browser can open `/player`. For a TV without one, a Raspberry Pi behind
it works, down to the original Pi Zero W, which is too slow for a browser.
`pi/player/` is a small Python player that draws the board into the Linux
framebuffer and plays the flap clicks over HDMI.

1. On a Mac, write the SD card: `pi/make-sd.sh` (Raspberry Pi OS Lite 32-bit,
   Wi-Fi and your SSH key; asks for sudo). The Zero W sees 2.4 GHz Wi-Fi only.
2. Boot the Pi, then copy `pi/player/` to it and run
   `sudo ./install.sh https://your-server`. It starts at boot as
   `clackboard.service`; logs: `journalctl -u clackboard -f`.
3. Pair the code shown on the TV in `/app`.

## License

MIT
