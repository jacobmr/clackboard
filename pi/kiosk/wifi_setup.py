#!/usr/bin/env python3
"""Clackboard TV Wi-Fi setup.

When the Pi has no internet for OFFLINE_GRACE seconds, it starts its own
Wi-Fi network ("Clackboard-Setup") and the TV shows that network's password.
Join it from a phone: a setup page opens (captive portal) where you pick the
venue's Wi-Fi and type its password.

While the setup network is up, every AP_WINDOW seconds (unless someone is
using the setup page) it turns the setup network off for RETRY_WINDOW seconds
so NetworkManager can rejoin a saved network (home, phone hotspot, a venue
joined earlier). The Pi 4 has one radio: it cannot run its own network and
join another one at the same time.

Two web servers:
  127.0.0.1:8080  the kiosk's start page (/), /status.json, and /setup
                  (the same setup page, for testing over an SSH tunnel)
  10.42.0.1:80    the setup page for phones; only while the setup network is up

Runs as root (nmcli changes system connections). Standard library only.
"""
import html
import json
import os
import secrets
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER = os.environ.get("CLACKBOARD_SERVER", "https://www.clackboard.fyi")
PLAYER_URL = SERVER + "/player?kiosk"
IFACE = "wlan0"
AP_CON = "clackboard-setup"
AP_SSID = "Clackboard-Setup"
AP_IP = "10.42.0.1"
JOINED_PREFIX = "clackboard-net-"
JOIN_PRIORITY = "5"  # above home (0) and the phone hotspot (-10)
OFFLINE_GRACE = 90
AP_WINDOW = 300
RETRY_WINDOW = 45
PORTAL_BUSY = 120  # a setup-page request this recent postpones the retry
SIGNIN_WINDOW = 600  # time to accept a venue's terms on the TV
# Plain-HTTP check page: answers 204 on the open internet. A venue sign-in
# system intercepts it, so opening it in the kiosk shows the venue's page.
PROBE = "http://connectivitycheck.gstatic.com/generate_204"
CHECK_EVERY = 20

lock = threading.RLock()
state = {
    "mode": "starting",  # starting | online | setup | signin | joining | retrying
    "ssid": "",  # Wi-Fi network in use, if any
    "message": "",  # last result, shown on the TV and the setup page
    "networks": [],  # [{"ssid", "signal", "security"}], from the last scan
    "saved": [],  # saved Wi-Fi connection names
    "ap_pass": f"{secrets.randbelow(10**8):08d}",
    "signin_since": 0.0,
}
last_portal_hit = 0.0
ap_server = None
tv_seen = False


def log(*a):
    print(*a, flush=True)


def nm(*args, timeout=30):
    """Run nmcli with list arguments (never a shell). Returns (ok, stdout)."""
    try:
        r = subprocess.run(["nmcli", *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        log("nmcli timeout:", args[:3])
        return False, ""
    if r.returncode != 0:
        log("nmcli failed:", args[:3], r.stderr.strip()[:200])
    return r.returncode == 0, r.stdout


def split_terse(line):
    """Split one line of `nmcli -t` output: ':' separates, '\\:' is a literal colon."""
    out, cur, esc = [], "", False
    for ch in line:
        if esc:
            cur += ch
            esc = False
        elif ch == "\\":
            esc = True
        elif ch == ":":
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return out


def online():
    """True if the internet works. A venue sign-in page fails both checks.

    Our server first (over TLS); if it is down, Google's check page, so an
    outage of our server alone never drops a working Wi-Fi network."""
    req = urllib.request.Request(SERVER + "/favicon.ico", method="HEAD")
    try:
        urllib.request.urlopen(req, timeout=6).close()
        return True
    except urllib.error.HTTPError:
        return True  # our server answered, with a valid certificate
    except Exception:
        pass
    try:
        with urllib.request.urlopen(PROBE, timeout=6) as r:
            return r.status == 204  # a sign-in page answers 200 or redirects
    except Exception:
        return False


def claim(mode):
    """Atomically move from an idle mode to a busy one. False if already busy."""
    with lock:
        if state["mode"] in ("joining", "retrying"):
            return False
        state["mode"] = mode
        return True


def current_ssid():
    ok, out = nm("-t", "-f", "ACTIVE,SSID", "device", "wifi", "list", "ifname", IFACE, "--rescan", "no")
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) >= 2 and f[0] == "yes":
            return f[1]
    return ""


def scan():
    """Scan for networks. Only works while the setup network is down."""
    nm("device", "wifi", "rescan", "ifname", IFACE, timeout=20)
    time.sleep(4)
    ok, out = nm("-t", "-f", "SSID,SIGNAL,SECURITY", "device", "wifi", "list", "ifname", IFACE, "--rescan", "no")
    best = {}
    for line in out.splitlines():
        f = split_terse(line)
        if len(f) < 3 or not f[0] or f[0] == AP_SSID:
            continue
        ssid, sec = f[0], f[2]
        try:
            sig = int(f[1])
        except ValueError:
            sig = 0
        if ssid not in best or sig > best[ssid]["signal"]:
            best[ssid] = {"ssid": ssid, "signal": sig, "security": sec}
    nets = sorted(best.values(), key=lambda n: -n["signal"])
    ok, out = nm("-t", "-f", "NAME,TYPE", "connection", "show")
    saved = []
    for l in out.splitlines():
        name = split_terse(l)[0]
        if l.endswith(":802-11-wireless") and name != AP_CON:
            for p in ("netplan-wlan0-", JOINED_PREFIX):
                name = name.removeprefix(p)
            saved.append(name)
    with lock:
        if nets:
            state["networks"] = nets
        state["saved"] = saved
    log("scan:", len(nets), "networks")


def ap_up():
    global ap_server
    nm("connection", "delete", "id", AP_CON)
    ok, _ = nm(
        "connection", "add", "type", "wifi", "ifname", IFACE, "con-name", AP_CON,
        "ssid", AP_SSID, "autoconnect", "no",
        "802-11-wireless.mode", "ap", "802-11-wireless.band", "bg", "802-11-wireless.channel", "6",
        "ipv4.method", "shared", "ipv4.addresses", AP_IP + "/24", "ipv6.method", "disabled",
        "wifi-sec.key-mgmt", "wpa-psk", "wifi-sec.psk", state["ap_pass"],
        "wifi-sec.proto", "rsn", "wifi-sec.pairwise", "ccmp", "wifi-sec.group", "ccmp",
        "wifi-sec.pmf", "disable",
    )
    ok = ok and nm("connection", "up", "id", AP_CON, timeout=45)[0]
    log("setup network up:", ok)
    if ok:
        for _ in range(10):  # the address appears a moment after "up"
            with lock:
                if ap_server is not None:
                    break
                try:
                    srv = ThreadingHTTPServer((AP_IP, 80), Handler)
                except OSError:
                    srv = None
                if srv is not None:
                    srv.portal = True
                    ap_server = srv
                    threading.Thread(target=srv.serve_forever, daemon=True).start()
                    break
            time.sleep(1)
    return ok


def ap_down():
    """Stop the setup network and delete it, so NetworkManager can't pick it
    when it looks for a network to rejoin (ap_up recreates it)."""
    global ap_server
    with lock:
        srv, ap_server = ap_server, None
    if srv is not None:
        srv.shutdown()
        srv.server_close()
    nm("connection", "delete", "id", AP_CON, timeout=20)
    log("setup network down")


def restart_kiosk():
    try:
        subprocess.run(["systemctl", "restart", "clackboard-kiosk.service"], timeout=30)
    except Exception as e:
        log("kiosk restart failed:", e)


def wait_online(seconds):
    end = time.time() + seconds
    while time.time() < end:
        if online():
            return True
        time.sleep(3)
    return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def needs_signin():
    """True if Wi-Fi is up but a venue sign-in page intercepts web traffic."""
    if not current_ssid():
        return False
    try:
        with urllib.request.build_opener(_NoRedirect).open(PROBE, timeout=6) as r:
            return r.status != 204  # the venue answered with its own page
    except urllib.error.HTTPError as e:
        return 300 <= e.code < 400  # redirected to the venue's page
    except Exception:
        return False


def enter_signin(ssid):
    """Show the venue's sign-in page on the TV (the touchpad clicks Accept)."""
    log("sign-in page needed on", ssid)
    set_state(mode="signin", ssid=ssid, signin_since=time.time(),
              message=f"{ssid} needs you to accept its terms.")
    restart_kiosk()


def set_state(**kw):
    with lock:
        state.update(kw)


def enter_setup(message=""):
    scan()
    set_state(mode="setup", ssid="", message=message)
    if ap_up():
        restart_kiosk()  # the kiosk start page shows the setup steps
    else:
        set_state(message="Could not start the setup network. Restart the Pi to try again.")


def join(ssid, password, hidden):
    """Runs in a thread, after claim("joining"). Leaves the Pi online, or back
    in setup mode. Tries a temporary profile, so a mistyped password never
    deletes a venue network that already worked."""
    set_state(message=f"Joining {ssid}…")
    ap_down()
    final = JOINED_PREFIX + ssid
    name = final + "-try"
    nm("connection", "delete", "id", name)
    sec = next((n["security"] for n in state["networks"] if n["ssid"] == ssid), "")
    args = ["connection", "add", "type", "wifi", "ifname", IFACE, "con-name", name,
            "ssid", ssid, "connection.autoconnect-priority", JOIN_PRIORITY]
    if password:
        mgmt = "sae" if "WPA3" in sec and "WPA2" not in sec and "WPA1" not in sec else "wpa-psk"
        args += ["wifi-sec.key-mgmt", mgmt, "wifi-sec.psk", password]
    if hidden:
        args += ["802-11-wireless.hidden", "yes"]
    ok = nm(*args)[0]
    if ok:
        nm("device", "wifi", "rescan", "ifname", IFACE, timeout=20)
        time.sleep(3)
        ok = nm("connection", "up", "id", name, timeout=60)[0]
    if ok and wait_online(25):
        log("joined", ssid)
        nm("connection", "delete", "id", final)
        nm("connection", "modify", "id", name, "connection.id", final)
        set_state(mode="online", ssid=ssid, message=f"Joined {ssid}.")
        return
    if ok and needs_signin():
        nm("connection", "delete", "id", final)
        nm("connection", "modify", "id", name, "connection.id", final)
        enter_signin(ssid)
        return
    nm("connection", "delete", "id", name)
    why = "it has no internet" if ok else "check the password, or move the Pi closer"
    log("join failed:", ssid, "connected" if ok else "not connected")
    enter_setup(f"Couldn't use {ssid}: {why}.")


def rescan_now():
    """Runs in a thread, after claim("retrying")."""
    set_state(message="Scanning for networks…")
    ap_down()
    scan()
    set_state(mode="setup", message="")
    ap_up()


def retry_saved():
    """Give saved networks a chance while the setup network is down. Called
    after claim("retrying"). NetworkManager's own autoconnect picks the saved
    network by priority."""
    set_state(message="")
    ap_down()
    nm("device", "wifi", "rescan", "ifname", IFACE, timeout=20)
    if wait_online(RETRY_WINDOW):
        set_state(mode="online", ssid=current_ssid(), message="")
        log("back online via", state["ssid"] or "ethernet")
        return
    if needs_signin():
        enter_signin(current_ssid())
        return
    scan()
    set_state(mode="setup")
    ap_up()


def watch():
    last_ok = time.time()
    ap_since = 0.0
    while True:
        mode = state["mode"]
        if mode in ("joining", "retrying"):
            time.sleep(2)
            continue
        if mode == "signin":
            if online():  # terms accepted: back to the board
                log("signed in; back online")
                set_state(mode="online", message="")
                last_ok = time.time()
                restart_kiosk()
            elif time.time() - state["signin_since"] > SIGNIN_WINDOW:
                enter_setup(f"Nobody accepted the terms for {state['ssid']}.")
            time.sleep(5)
            continue
        if mode == "setup":
            if online():  # e.g. an Ethernet cable was plugged in
                ap_down()
                set_state(mode="online", ssid=current_ssid(), message="")
                last_ok = time.time()
            elif not ap_since:
                ap_since = time.time()
            elif (time.time() - ap_since > AP_WINDOW
                  and time.time() - last_portal_hit > PORTAL_BUSY and claim("retrying")):
                retry_saved()
                ap_since = 0.0
                last_ok = time.time()
            time.sleep(5)
            continue
        ap_since = 0.0
        if online():
            last_ok = time.time()
            if mode != "online" or not state["ssid"]:
                set_state(mode="online", ssid=current_ssid())
        elif time.time() - last_ok > OFFLINE_GRACE:
            if needs_signin():
                enter_signin(current_ssid())
            else:
                log("offline for", OFFLINE_GRACE, "s: starting the setup network")
                enter_setup()
            continue
        time.sleep(CHECK_EVERY if state["mode"] == "online" else 5)


# ---------- pages ----------

STYLE = """
:root { color-scheme: light dark; }
body { font: 20px/1.45 system-ui, sans-serif; margin: 0 auto; padding: 16px; max-width: 34em; }
h1 { font-size: 1.5em; margin: .2em 0 .6em; }
label.net { display: flex; gap: .6em; align-items: center; padding: .7em .5em;
  border-bottom: 1px solid #8884; }
label.net small { margin-left: auto; opacity: .7; }
input[type=password], input[type=text] { font: inherit; width: 100%; box-sizing: border-box;
  padding: .5em; margin: .3em 0 1em; }
button { font: inherit; padding: .6em 1.2em; margin: .3em .5em .3em 0; }
.msg { padding: .6em .8em; border-radius: 6px; background: #f5c54233; }
"""


def page(title, body):
    return (f"<!doctype html><html><head><meta charset=utf-8>"
            f"<meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>{html.escape(title)}</title><style>{STYLE}</style></head>"
            f"<body>{body}</body></html>")


def setup_page():
    with lock:
        nets, msg = list(state["networks"]), state["message"]
    rows = []
    for i, n in enumerate(nets):
        enterprise = "802.1X" in n["security"]
        lock_icon = "🔒" if n["security"] and n["security"] != "--" else ""
        note = " (needs a username; not supported)" if enterprise else ""
        rows.append(
            f"<label class=net><input type=radio name=ssid value='{html.escape(n['ssid'], True)}'"
            f"{' disabled' if enterprise else ''}{' checked' if i == 0 else ''}>"
            f"{html.escape(n['ssid'])}{note} <small>{lock_icon} {n['signal']}%</small></label>")
    rows.append("<label class=net><input type=radio name=ssid value=''>"
                "Other (hidden) network:</label><input type=text name=other maxlength=32>")
    m = f"<p class=msg>{html.escape(msg)}</p>" if msg else ""
    return page("Clackboard Wi-Fi", f"""
<h1>Pick the Wi-Fi for Clackboard</h1>{m}
<form method=post action=/join>{''.join(rows)}
<p><label>Password (blank if none)<input type=password name=password maxlength=63
 autocomplete=off></label></p>
<button type=submit>Join</button></form>
<form method=post action=/rescan><button type=submit>Scan again</button>
<small>Your phone disconnects for about 20 seconds; rejoin {AP_SSID} after.</small></form>""")


def tv_page():
    player = json.dumps(PLAYER_URL)
    return page("Clackboard", f"""
<style>body {{ max-width: none; font-size: 2.5vw; padding: 2.5vw 5vw; }}
b {{ font-family: ui-monospace, monospace; }} li {{ margin: .4em 0; }}</style>
<div id=root>Connecting to Wi-Fi…</div>
<script>
const PLAYER = {player};
const esc = s => String(s).replace(/[&<>"']/g, c => "&#" + c.charCodeAt(0) + ";");
async function tick() {{
  let s;
  try {{ s = await (await fetch("/status.json", {{cache: "no-store"}})).json(); }}
  catch (e) {{ return; }}
  if (s.mode === "online") {{ location.replace(PLAYER); return; }}
  const r = document.getElementById("root");
  const msg = s.message ? `<p>${{esc(s.message)}}</p>` : "";
  if (s.mode === "signin") {{
    r.innerHTML = `<h1>${{esc(s.message)}}</h1>
      <p>Its sign-in page opens next. Use the keyboard's touchpad to accept.
      The board comes back by itself once the internet works.</p>`;
    if (!window.opening) {{ window.opening = setTimeout(() => location.href = s.probe, 8000); }}
    return;
  }}
  if (s.mode === "setup") {{
    r.innerHTML = `<h1>Clackboard needs Wi-Fi</h1>${{msg}}<ol>
      <li>On your phone, join Wi-Fi <b>${{esc(s.ap_ssid)}}</b><br>password <b>${{esc(s.ap_pass)}}</b></li>
      <li>A setup page opens. If it doesn't, go to <b>http://${{esc(s.ap_ip)}}</b></li>
      <li>Pick this venue's Wi-Fi and type its password.</li></ol>
      <p style="opacity:.7">Every few minutes it also tries the saved networks:
      ${{esc(s.saved.join(", ") || "none")}}.</p>`;
  }} else if (s.mode === "joining") {{
    r.innerHTML = `<h1>${{esc(s.message)}}</h1>`;
  }} else if (s.mode === "retrying") {{
    r.innerHTML = `<h1>Trying saved networks…</h1><p>${{esc(s.saved.join(", "))}}</p>`;
  }} else {{
    r.innerHTML = `<h1>Connecting to Wi-Fi…</h1>`;
  }}
}}
tick(); setInterval(tick, 3000);
</script>""")


class Handler(BaseHTTPRequestHandler):
    server_version = "clackboard-wifi"

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="text/html; charset=utf-8", extra=()):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    @property
    def portal(self):
        return getattr(self.server, "portal", False)

    def touch(self):
        """Note real use of the setup page (not phones' background checks)."""
        global last_portal_hit
        if self.portal:
            last_portal_hit = time.time()

    def host_ok(self):
        # The 8080 server answers only to its own name: a DNS-rebinding page
        # (evil.example resolving to 127.0.0.1) sends a different Host.
        return self.portal or self.headers.get("Host") in ("127.0.0.1:8080", "localhost:8080")

    def do_GET(self):
        if not self.host_ok():
            return self.send(403, "forbidden", "text/plain")
        path = urllib.parse.urlsplit(self.path).path
        if self.portal:
            if path == "/" and self.headers.get("Host", "").split(":")[0] == AP_IP:
                self.touch()
                return self.send(200, setup_page())
            # Anything else (phone captive-portal checks): send to the setup page.
            return self.send(302, "", extra=[("Location", f"http://{AP_IP}/")])
        if path == "/":
            return self.send(200, tv_page())
        if path == "/setup":
            return self.send(200, setup_page())
        if path == "/status.json":
            global tv_seen
            if not tv_seen:
                tv_seen = True
                log("kiosk start page is polling")
            with lock:
                s = {k: state[k] for k in ("mode", "ssid", "message", "saved", "ap_pass")}
            s.update(ap_ssid=AP_SSID, ap_ip=AP_IP, probe=PROBE)
            return self.send(200, json.dumps(s), "application/json")
        self.send(404, "not found", "text/plain")

    def do_POST(self):
        if not self.host_ok():
            return self.send(403, "forbidden", "text/plain")
        self.touch()
        # On 127.0.0.1, refuse posts from other sites' pages. (The setup network
        # skips this: phone captive-portal sheets may send "Origin: null".)
        origin = self.headers.get("Origin")
        if (not self.portal and origin
                and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host")):
            return self.send(403, "forbidden", "text/plain")
        try:
            n = max(0, min(int(self.headers.get("Content-Length") or 0), 4096))
        except ValueError:
            n = 0
        form = urllib.parse.parse_qs(self.rfile.read(n).decode("utf-8", "replace"))
        get = lambda k: (form.get(k) or [""])[0]
        path = urllib.parse.urlsplit(self.path).path
        busy = page("Busy", "<p>Busy; try again in a minute.</p>")
        if path == "/rescan":
            if not claim("retrying"):
                return self.send(409, busy)
            threading.Thread(target=rescan_now, daemon=True).start()
            return self.send(200, page("Scanning", f"<h1>Scanning…</h1><p>Rejoin "
                             f"<b>{AP_SSID}</b> in about 20 seconds, then go to http://{AP_IP}</p>"))
        if path != "/join":
            return self.send(404, "not found", "text/plain")
        ssid, hidden = get("ssid"), False
        if not ssid:
            ssid, hidden = get("other").strip(), True
        pw = get("password")
        bad = ""
        if not ssid or len(ssid.encode()) > 32 or any(c in ssid for c in "\0\n\r"):
            bad = "Pick a network."
        elif pw and not 8 <= len(pw) <= 63:
            bad = "Wi-Fi passwords are 8 to 63 characters."
        elif any(c in pw for c in "\0\n\r"):
            bad = "That password has a character Wi-Fi doesn't allow."
        elif ssid.startswith("--") or pw.startswith("--"):
            bad = "Names and passwords starting with -- aren't supported."
        if bad:
            with lock:
                state["message"] = bad
            return self.send(200, setup_page())
        if not claim("joining"):
            return self.send(409, busy)
        threading.Thread(target=join, args=(ssid, pw, hidden), daemon=True).start()
        self.send(200, page("Joining", f"""<h1>Joining {html.escape(ssid)}…</h1>
<p>Your phone will drop off {AP_SSID}. Watch the TV: it shows the board when this works.</p>
<p>If it doesn't work, {AP_SSID} comes back in about a minute with the reason.</p>"""))


def main():
    os.makedirs("/etc/NetworkManager/dnsmasq-shared.d", exist_ok=True)
    nm("connection", "delete", "id", AP_CON, timeout=20)  # left over from a crash
    tv = ThreadingHTTPServer(("127.0.0.1", 8080), Handler)
    threading.Thread(target=tv.serve_forever, daemon=True).start()
    log("clackboard-wifi: listening on 127.0.0.1:8080")
    watch()


if __name__ == "__main__":
    main()
