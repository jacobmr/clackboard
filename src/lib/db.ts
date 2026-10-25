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
  | { kind: "calendar"; seconds: number; title: string; url: string; days: number };

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
  ready ??= client.execute(SCHEMA).then(() => undefined);
  await ready;
  return client;
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
  await c.execute({
    sql: `INSERT INTO screens (id, owner_id, name, device_token, pair_code, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [randomBytes(8).toString("hex"), DEFAULT_OWNER, "New screen", deviceToken, code, Date.now()],
  });
  return { deviceToken, code };
}

export async function screenByDevice(deviceToken: string): Promise<Screen | null> {
  const c = await db();
  const res = await c.execute({
    sql: "UPDATE screens SET last_seen = ? WHERE device_token = ? RETURNING *",
    args: [Date.now(), deviceToken],
  });
  return res.rows[0] ? toScreen(res.rows[0]) : null;
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
    args: [owner, name, code.toUpperCase().replace(/[^A-Z0-9]/g, "")],
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
