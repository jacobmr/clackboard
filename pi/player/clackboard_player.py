#!/usr/bin/env python3
"""Clackboard player for small Pis (Pi Zero W) that cannot run a browser.

Draws the split-flap board straight to the screen with pygame (KMS/DRM, no
desktop) and polls the same API as the web player, asking for messages
already laid out as grids, so the layout rules live only on the server.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import pygame

SERVER = os.environ.get("CLACKBOARD_SERVER", "https://clackboard.vercel.app").rstrip("/")
STATE_FILE = os.path.expanduser(os.environ.get("CLACKBOARD_STATE", "~/.config/clackboard/device.json"))
POLL_S = 4
STEP_S = 0.065  # one flap step, same as the web board
FPS = 30

# Must match src/lib/board.ts.
CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&()-+=;:'\",./?°"
COLORS = {
    "red": "#d6453d",
    "orange": "#e8833a",
    "yellow": "#f2c53d",
    "green": "#3fa66a",
    "blue": "#3b7dd8",
    "violet": "#8a5cc7",
    "white": "#f4f1ea",
}
CHARSET = list(CHARS) + ["{%s}" % c for c in COLORS]
INDEX = {c: i for i, c in enumerate(CHARSET)}

# Must match src/components/Board.module.css.
THEMES = {
    "dark": {"flap": "#1b1b1d", "edge": "#0c0c0d", "ink": "#f3efe6", "frame": "#050506", "bg": "#000000"},
    "light": {"flap": "#f1eee7", "edge": "#d8d3c8", "ink": "#1a1a1a", "frame": "#c9c3b6", "bg": "#e9e5dc"},
}


# --- server ------------------------------------------------------------------

def http_json(method, path):
    req = urllib.request.Request(SERVER + path, method=method, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)


def load_token():
    try:
        with open(STATE_FILE) as f:
            return json.load(f).get("deviceToken")
    except (OSError, ValueError):
        return None


def save_token(token):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"deviceToken": token}, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, STATE_FILE)


class Poller(threading.Thread):
    """Fetches the screen state every few seconds; keeps the last good one."""

    def __init__(self):
        super().__init__(daemon=True)
        self.state = None
        self.token = load_token()

    def fetch(self):
        if not self.token:
            self.token = http_json("POST", "/api/devices")["deviceToken"]
            save_token(self.token)
        q = urllib.parse.urlencode({"token": self.token, "format": "grid"})
        try:
            return http_json("GET", "/api/player?" + q)
        except urllib.error.HTTPError as e:
            if e.code != 404:
                raise
            # The screen was removed in the app: start over with a new code.
            self.token = None
            return self.fetch()

    def run(self):
        while True:
            try:
                self.state = self.fetch()
            except Exception as e:  # offline, server down: keep showing what we have
                print("poll failed:", e, flush=True)
            time.sleep(POLL_S)


class Rotation:
    """Which grid to show now. Restarts only when the playlist's durations change."""

    def __init__(self):
        self.key = None
        self.index = 0
        self.until = 0

    def grid(self, state):
        if not state:
            return None
        if not state.get("paired"):
            return state.get("grid")
        if state.get("override"):
            return state["override"].get("grid")
        items = state.get("items") or []
        if not items:
            return None
        key = tuple(i["seconds"] for i in items)
        now = time.monotonic()
        if key != self.key:
            self.key, self.index, self.until = key, 0, now + items[0]["seconds"]
        elif now >= self.until:
            self.index = (self.index + 1) % len(items)
            self.until = now + items[self.index]["seconds"]
        return items[self.index % len(items)].get("grid")


# --- drawing -------------------------------------------------------------------

class Tiles:
    """Pre-rendered flap halves for every character, at one cell size."""

    def __init__(self, w, h, theme):
        self.w, self.h, self.half = w, h, h // 2
        t = THEMES[theme]
        font = pygame.font.Font(None, int(h * 0.95))
        radius = max(1, int(w * 0.08))
        self.top, self.bottom, self.top_fold, self.bottom_fold = {}, {}, {}, {}
        for ch in CHARSET:
            full = pygame.Surface((w, h), pygame.SRCALPHA)
            if ch.startswith("{"):
                pygame.draw.rect(full, COLORS[ch[1:-1]], full.get_rect(), border_radius=radius)
            else:
                pygame.draw.rect(full, t["flap"], full.get_rect(), border_radius=radius)
                if ch != " ":
                    g = font.render(ch, True, t["ink"])
                    full.blit(g, g.get_rect(center=(w // 2, h // 2 + int(h * 0.04))))
            # The split line across the middle.
            pygame.draw.line(full, t["edge"], (0, self.half), (w, self.half), max(1, h // 40))
            top = full.subsurface((0, 0, w, self.half)).copy()
            bottom = full.subsurface((0, self.half, w, h - self.half)).copy()
            self.top[ch], self.bottom[ch] = top, bottom
            # A folding leaf seen edge-on is a squashed half.
            self.top_fold[ch] = pygame.transform.smoothscale(top, (w, max(1, self.half // 3)))
            self.bottom_fold[ch] = pygame.transform.smoothscale(bottom, (w, max(1, (h - self.half) // 3)))

    def draw(self, surf, x, y, old, new, phase, bg):
        """phase 0..1 within one flap step from old to new."""
        surf.fill(bg, (x, y, self.w, self.h))
        if phase >= 1:
            surf.blit(self.top[new], (x, y))
            surf.blit(self.bottom[new], (x, y + self.half))
        elif phase < 0.5:
            # Old top leaf falls toward the hinge, uncovering the new top.
            surf.blit(self.top[new], (x, y))
            surf.blit(self.bottom[old], (x, y + self.half))
            leaf = self.top_fold[old]
            surf.blit(leaf, (x, y + self.half - leaf.get_height()))
        else:
            # The leaf's back (new bottom) lands over the old bottom.
            surf.blit(self.top[new], (x, y))
            surf.blit(self.bottom[old], (x, y + self.half))
            surf.blit(self.bottom_fold[new], (x, y + self.half))


class Board:
    def __init__(self, screen):
        self.screen = screen
        self.layout_key = None
        self.cells = []  # [row][col] -> {"cur": ch, "target": ch, "t": step start}

    def setup(self, rows, cols, theme):
        W, H = self.screen.get_size()
        # Same proportions as the CSS: cell w, height 1.45w, gap .12w, padding .5w.
        w = min(W / (cols + (cols - 1) * 0.12 + 1), H / (rows * 1.45 + (rows - 1) * 0.12 + 1))
        self.w, self.h, self.gap = int(w), int(w * 1.45), max(1, int(w * 0.12))
        bw = cols * self.w + (cols - 1) * self.gap + 2 * int(w * 0.5)
        bh = rows * self.h + (rows - 1) * self.gap + 2 * int(w * 0.5)
        self.ox, self.oy = (W - bw) // 2 + int(w * 0.5), (H - bh) // 2 + int(w * 0.5)
        self.theme = THEMES[theme]
        self.tiles = Tiles(self.w, self.h, theme)
        old = self.cells
        self.cells = [[{"cur": " ", "target": " ", "t": 0} for _ in range(cols)] for _ in range(rows)]
        for r, row in enumerate(old[:rows]):
            for c, cell in enumerate(row[:cols]):
                self.cells[r][c]["cur"] = cell["cur"]
        self.screen.fill(self.theme["bg"])
        frame = pygame.Rect(self.ox - int(w * 0.5), self.oy - int(w * 0.5), bw, bh)
        pygame.draw.rect(self.screen, self.theme["frame"], frame, border_radius=int(w * 0.3))
        for r in range(rows):
            for c in range(cols):
                self.draw_cell(r, c, 1)
        pygame.display.flip()

    def set_grid(self, grid, config):
        key = (config["rows"], config["cols"], config.get("theme", "dark"))
        if key != self.layout_key:
            self.layout_key = key
            self.setup(*key)
        now = time.monotonic()
        for r, row in enumerate(self.cells):
            for c, cell in enumerate(row):
                ch = grid[r][c] if grid and r < len(grid) and c < len(grid[r]) else " "
                ch = ch if ch in INDEX else " "
                if ch != cell["target"]:
                    if cell["cur"] == cell["target"]:
                        cell["t"] = now
                    cell["target"] = ch

    def xy(self, r, c):
        return self.ox + c * (self.w + self.gap), self.oy + r * (self.h + self.gap)

    def draw_cell(self, r, c, phase, old=None, new=None):
        cell = self.cells[r][c]
        x, y = self.xy(r, c)
        self.tiles.draw(self.screen, x, y, old or cell["cur"], new or cell["cur"], phase, self.theme["frame"])
        return pygame.Rect(x, y, self.w, self.h)

    def tick(self):
        """Advance every moving flap; return the screen areas that changed."""
        now = time.monotonic()
        dirty = []
        for r, row in enumerate(self.cells):
            for c, cell in enumerate(row):
                if cell["cur"] == cell["target"]:
                    continue
                # Step forward through the drum, wrapping, like a real flap.
                nxt = CHARSET[(INDEX[cell["cur"]] + 1) % len(CHARSET)]
                phase = (now - cell["t"]) / STEP_S
                if phase >= 1:
                    cell["cur"], cell["t"] = nxt, now
                    dirty.append(self.draw_cell(r, c, 1))
                else:
                    dirty.append(self.draw_cell(r, c, phase, cell["cur"], nxt))
        return dirty


def main():
    os.environ.setdefault("SDL_VIDEODRIVER", "kmsdrm")
    pygame.display.init()
    pygame.font.init()
    pygame.mouse.set_visible(False)
    screen = pygame.display.set_mode((0, 0), pygame.FULLSCREEN)
    print("screen", screen.get_size(), pygame.display.get_driver(), flush=True)

    poller = Poller()
    poller.start()
    rotation = Rotation()
    board = Board(screen)
    clock = pygame.time.Clock()

    while True:
        for e in pygame.event.get():
            if e.type == pygame.QUIT or (e.type == pygame.KEYDOWN and e.key == pygame.K_ESCAPE):
                return
        state = poller.state
        if state:
            board.set_grid(rotation.grid(state), state["config"])
        if board.layout_key:
            dirty = board.tick()
            if dirty:
                pygame.display.update(dirty)
        clock.tick(FPS)


if __name__ == "__main__":
    main()
