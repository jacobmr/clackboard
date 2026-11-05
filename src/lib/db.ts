import { createClient, type Client } from "@libsql/client";
import { randomBytes } from "node:crypto";
import type { Align } from "./board";

// Local dev uses a SQLite file; production points TURSO_DATABASE_URL at Turso.
let client: Client | null = null;
let ready: Promise<void> | null = null;

// Every row carries an owner so accounts can be added later without a migration.
export const DEFAULT_OWNER = "default";

export type PlaylistItem =
  | { kind: "text"; text: string; seconds: number }
  | { kind: "time"; seconds: number; timezone?: string }
  | { kind: "weather"; seconds: number; place: string; lat: number; lon: number }
  | { kind: "ha"; seconds: number; title: string; entities: { id: string; label: string }[] }
  | { kind: "calendar"; seconds: number; title: string; url: string; days: number }
  // size: percent of the screen's width the video fills (100 = full screen).
  | { kind: "video"; seconds: number; url: string; size?: number };

export type Override = { text: string; until: number };

export type Screen = {
  id: string;
  name: string;
  pairCode: string | null;
  paired: boolean;
  rows: number;
  cols: number;
  align: Align;
  theme: "dark" | "light";
  sound: boolean;
  playlist: PlaylistItem[];
  override: Override | null;
  version: number;
  lastSeen: number | null;
  // A sign-in code the TV shows for a while after it boots.
  login: { code: string; until: number } | null;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  device_token TEXT NOT NULL UNIQUE,
  pair_code TEXT UNIQUE,
  paired INTEGER NOT NULL DEFAULT 0,
  rows INTEGER NOT NULL DEFAULT 6,
  cols INTEGER NOT NULL DEFAULT 22,
  align TEXT NOT NULL DEFAULT 'center',
  theme TEXT NOT NULL DEFAULT 'dark',
  sound INTEGER NOT NULL DEFAULT 1,
  playlist TEXT NOT NULL DEFAULT '[]',
  override TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
)`;

export async function db(): Promise<Client> {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "file:clackboard.db",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  ready ??= migrate(client);
  await ready;
  return client;
}

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
const COLUMNS = ["login_code TEXT", "login_until INTEGER"];

async function migrate(c: Client): Promise<void> {
  await c.execute(SCHEMA);
  const have = new Set((await c.execute("PRAGMA table_info(screens)")).rows.map((r) => String(r.name)));
  for (const col of COLUMNS) {
    if (!have.has(col.split(" ")[0])) await c.execute(`ALTER TABLE screens ADD COLUMN ${col}`);
  }
}

function toScreen(row: Record<string, unknown>): Screen {
  return {
    id: String(row.id),
    name: String(row.name),
    pairCode: row.pair_code == null ? null : String(row.pair_code),
    paired: Number(row.paired) === 1,
    rows: Number(row.rows),
    cols: Number(row.cols),
    align: row.align === "left" ? "left" : "center",
    theme: row.theme === "light" ? "light" : "dark",
    sound: Number(row.sound) === 1,
    playlist: JSON.parse(String(row.playlist)),
    override: row.override ? JSON.parse(String(row.override)) : null,
    version: Number(row.version),
    lastSeen: row.last_seen == null ? null : Number(row.last_seen),
    login:
      row.login_code && Number(row.login_until) > Date.now()
        ? { code: String(row.login_code), until: Number(row.login_until) }
        : null,
  };
}

// No 0/O or 1/I, so a code read off a TV across the room is unambiguous.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function pairCode(): string {
  const bytes = randomBytes(6);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export async function createDevice(): Promise<{ deviceToken: string; code: string }> {
  const c = await db();
  const deviceToken = randomBytes(24).toString("base64url");
  const code = pairCode();
  // Every fresh player registers itself; drop codes nobody claimed that have
  // not polled for a day. A TV that comes back after that just gets a new code.
  await c.execute({
    sql: "DELETE FROM screens WHERE paired = 0 AND COALESCE(last_seen, created_at) < ?",
    args: [Date.now() - 24 * 60 * 60 * 1000],
  });
  await c.execute({
    sql: `INSERT INTO screens (id, owner_id, name, device_token, pair_code, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomBytes(8).toString("hex"), DEFAULT_OWNER, "New screen", deviceToken, code, Date.now()],
  });
  return { deviceToken, code };
}

export const LOGIN_MS = 2 * 60 * 1000;

// boot: the player just started (power-cycled TV, reloaded page). A paired
// screen then shows a sign-in code for LOGIN_MS: whoever can see the TV can
// sign in to its account.
export async function screenByDevice(deviceToken: string, boot = false): Promise<Screen | null> {
  const c = await db();
  const now = Date.now();
  const res = boot
    ? await c.execute({
        sql: `UPDATE screens SET last_seen = ?,
                login_code = CASE WHEN paired = 1 THEN ? END,
                login_until = CASE WHEN paired = 1 THEN ? END
              WHERE device_token = ? RETURNING *`,
        args: [now, pairCode(), now + LOGIN_MS, deviceToken],
      })
    : await c.execute({
        sql: "UPDATE screens SET last_seen = ? WHERE device_token = ? RETURNING *",
        args: [now, deviceToken],
      });
  return res.rows[0] ? toScreen(res.rows[0]) : null;
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Use a sign-in code once. Returns the account of the TV that showed it.
export async function redeemLoginCode(code: string): Promise<string | null> {
  const c = await db();
  const res = await c.execute({
    sql: `UPDATE screens SET login_code = NULL, login_until = NULL
          WHERE login_code = ? AND login_until > ? RETURNING owner_id`,
    args: [normalizeCode(code), Date.now()],
  });
  return res.rows[0] ? String(res.rows[0].owner_id) : null;
}

export function newOwner(): string {
  return randomBytes(12).toString("base64url");
}

export async function listScreens(owner: string): Promise<Screen[]> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM screens WHERE owner_id = ? AND paired = 1 ORDER BY created_at",
    args: [owner],
  });
  return res.rows.map(toScreen);
}

export async function getScreen(owner: string, id: string): Promise<Screen | null> {
  const c = await db();
  const res = await c.execute({
    sql: "SELECT * FROM screens WHERE owner_id = ? AND id = ?",
    args: [owner, id],
  });
  return res.rows[0] ? toScreen(res.rows[0]) : null;
}

export async function claimScreen(owner: string, code: string, name: string): Promise<Screen | null> {
  const c = await db();
  const res = await c.execute({
    sql: `UPDATE screens SET owner_id = ?, name = ?, paired = 1, pair_code = NULL, version = version + 1
          WHERE pair_code = ? AND paired = 0 RETURNING *`,
    args: [owner, name, normalizeCode(code)],
  });
  return res.rows[0] ? toScreen(res.rows[0]) : null;
}

export type ScreenPatch = Partial<
  Pick<Screen, "name" | "rows" | "cols" | "align" | "theme" | "sound" | "playlist" | "override">
>;

export async function updateScreen(owner: string, id: string, patch: ScreenPatch): Promise<Screen | null> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const put = (col: string, value: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(value);
  };
  if (patch.name !== undefined) put("name", patch.name);
  if (patch.rows !== undefined) put("rows", patch.rows);
  if (patch.cols !== undefined) put("cols", patch.cols);
  if (patch.align !== undefined) put("align", patch.align);
  if (patch.theme !== undefined) put("theme", patch.theme);
  if (patch.sound !== undefined) put("sound", patch.sound ? 1 : 0);
  if (patch.playlist !== undefined) put("playlist", JSON.stringify(patch.playlist));
  if (patch.override !== undefined) put("override", patch.override ? JSON.stringify(patch.override) : null);
  if (sets.length === 0) return getScreen(owner, id);

  const c = await db();
  const res = await c.execute({
    sql: `UPDATE screens SET ${sets.join(", ")}, version = version + 1
          WHERE owner_id = ? AND id = ? RETURNING *`,
    args: [...args, owner, id],
  });
  return res.rows[0] ? toScreen(res.rows[0]) : null;
}

export async function deleteScreen(owner: string, id: string): Promise<boolean> {
  const c = await db();
  const res = await c.execute({
    sql: "DELETE FROM screens WHERE owner_id = ? AND id = ?",
    args: [owner, id],
  });
  return res.rowsAffected > 0;
}
