import { clampSize } from "./board";
import type { PlaylistItem, ScreenPatch } from "./db";

// Turn an untrusted JSON body into a ScreenPatch, dropping anything invalid.
export function parsePatch(body: Record<string, unknown>, current: { rows: number; cols: number }): ScreenPatch {
  const patch: ScreenPatch = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
  if (body.rows !== undefined || body.cols !== undefined) {
    const size = clampSize(Number(body.rows ?? current.rows), Number(body.cols ?? current.cols));
    patch.rows = size.rows;
    patch.cols = size.cols;
  }
  if (body.align === "left" || body.align === "center") patch.align = body.align;
  if (body.theme === "dark" || body.theme === "light") patch.theme = body.theme;
  if (typeof body.sound === "boolean") patch.sound = body.sound;
  if (Array.isArray(body.playlist)) patch.playlist = body.playlist.flatMap(parseItem).slice(0, 50);
  return patch;
}

function seconds(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(3600, Math.max(5, Math.round(n))) : 15;
}

function parseItem(raw: unknown): PlaylistItem[] {
  if (!raw || typeof raw !== "object") return [];
  const it = raw as Record<string, unknown>;
  switch (it.kind) {
    case "text":
      return typeof it.text === "string"
        ? [{ kind: "text", text: it.text.slice(0, 2000), seconds: seconds(it.seconds) }]
        : [];
    case "time":
      return [
        {
          kind: "time",
          seconds: seconds(it.seconds),
          timezone: typeof it.timezone === "string" && it.timezone ? it.timezone : undefined,
        },
      ];
    case "weather": {
      const lat = Number(it.lat);
      const lon = Number(it.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
      const place = typeof it.place === "string" ? it.place.slice(0, 40) : "WEATHER";
      return [{ kind: "weather", seconds: seconds(it.seconds), place, lat, lon }];
    }
    default:
      return [];
  }
}

export function parseSend(body: Record<string, unknown>): { text: string; seconds: number } | null {
  if (typeof body.text !== "string" || !body.text.trim()) return null;
  const s = Number(body.seconds ?? 60);
  // 0 means "until cleared".
  const secs = Number.isFinite(s) ? Math.min(86400, Math.max(0, Math.round(s))) : 60;
  return { text: body.text.slice(0, 2000), seconds: secs };
}
