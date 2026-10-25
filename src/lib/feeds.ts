import ical, { type VEvent } from "node-ical";
import type { PlaylistItem } from "./db";

// Feeds render to board markup on the server, so the player only ever
// receives text. A renderer gets the board size so it can fit its lines.

export type Size = { rows: number; cols: number };

export async function renderItem(item: PlaylistItem, size: Size): Promise<string> {
  switch (item.kind) {
    case "text":
      return item.text;
    case "time":
      return renderTime(item.timezone);
    case "weather":
      return renderWeather(item.place, item.lat, item.lon);
    case "ha":
      return renderHomeAssistant(item.title, item.entities, size);
    case "calendar":
      return renderCalendar(item.title, item.url, item.days, size);
  }
}

function timezone(): string {
  return process.env.DEFAULT_TIMEZONE || "America/Los_Angeles";
}

// "LABEL ....... VALUE", padded to the board width.
function spread(label: string, value: string, cols: number): string {
  const room = cols - value.length - 1;
  return `${label.slice(0, Math.max(0, room)).padEnd(room)} ${value}`;
}

function renderTime(tz?: string): string {
  const now = new Date();
  const zone = tz || timezone();
  const day = now.toLocaleDateString("en-US", { timeZone: zone, weekday: "long" });
  const date = now.toLocaleDateString("en-US", { timeZone: zone, month: "short", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" });
  return `${day}\n${date}\n${time}`;
}

// --- weather: Open-Meteo, no API key. https://open-meteo.com/en/docs ---

const WEATHER_CODES: [number, string, string][] = [
  [0, "CLEAR", "{yellow}"],
  [3, "CLOUDY", "{white}"],
  [48, "FOG", "{white}"],
  [57, "DRIZZLE", "{blue}"],
  [67, "RAIN", "{blue}"],
  [77, "SNOW", "{white}"],
  [82, "SHOWERS", "{blue}"],
  [86, "SNOW SHOWERS", "{white}"],
  [99, "STORMS", "{violet}"],
];

function describe(code: number): [string, string] {
  for (const [max, label, tile] of WEATHER_CODES) {
    if (code <= max) return [label, tile];
  }
  return ["", ""];
}

async function renderWeather(place: string, lat: number, lon: number): Promise<string> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min" +
    "&temperature_unit=fahrenheit&timezone=auto&forecast_days=1";
  try {
    const res = await fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const now = Math.round(data.current.temperature_2m);
    const hi = Math.round(data.daily.temperature_2m_max[0]);
    const lo = Math.round(data.daily.temperature_2m_min[0]);
    const [label, tile] = describe(data.current.weather_code);
    return `${place}\n${tile} ${now}° ${label}\nHI ${hi}° LO ${lo}°`;
  } catch {
    return `${place}\nWEATHER UNAVAILABLE`;
  }
}

// --- Home Assistant: REST API with a long-lived access token ---
// HA_URL   e.g. https://ha.example.com (must be reachable from where this runs)
// HA_TOKEN Profile > Security > Long-lived access tokens

async function renderHomeAssistant(title: string, entities: { id: string; label: string }[], size: Size) {
  const base = process.env.HA_URL?.replace(/\/$/, "");
  const token = process.env.HA_TOKEN;
  if (!base || !token) return `${title}\nHOME ASSISTANT\nNOT CONFIGURED`;

  const lines = await Promise.all(
    entities.slice(0, size.rows - 1).map(async ({ id, label }) => {
      try {
        const res = await fetch(`${base}/api/states/${encodeURIComponent(id)}`, {
          headers: { authorization: `Bearer ${token}` },
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(String(res.status));
        const s = await res.json();
        const unit = s.attributes?.unit_of_measurement ?? "";
        const value = formatState(String(s.state), unit);
        return spread(label || s.attributes?.friendly_name || id, value, size.cols);
      } catch {
        return spread(label || id, "?", size.cols);
      }
    }),
  );
  return [title, ...lines].join("\n");
}

function formatState(state: string, unit: string): string {
  const n = Number(state);
  if (state !== "" && Number.isFinite(n)) {
    const rounded = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
    return `${rounded}${unit === "°F" || unit === "°C" ? "°" : unit ? ` ${unit}` : ""}`;
  }
  return state.replace(/_/g, " ");
}

// --- calendar: any iCal (.ics) URL, e.g. Google Calendar's "secret address" ---

async function renderCalendar(title: string, url: string, days: number, size: Size): Promise<string> {
  try {
    const res = await fetch(url, { next: { revalidate: 300 }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = ical.parseICS(await res.text());

    const now = new Date();
    const to = new Date(now.getTime() + Math.max(1, days) * 86400000);
    const from = new Date(now.getTime() - 86400000);
    const events = Object.values(data)
      .filter((c): c is VEvent => c?.type === "VEVENT")
      .flatMap((ev) => ical.expandRecurringEvent(ev, { from, to }))
      .filter((e) => e.end.getTime() > now.getTime() && e.start.getTime() < to.getTime())
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (events.length === 0) return `${title}\nNOTHING SCHEDULED`;

    const tz = timezone();
    const today = now.toLocaleDateString("en-US", { timeZone: tz });
    const lines = events.slice(0, size.rows - 1).map((e) => {
      const summary = typeof e.summary === "string" ? e.summary : (e.summary?.val ?? "");
      const sameDay = e.start.toLocaleDateString("en-US", { timeZone: tz }) === today;
      let when: string;
      if (e.isFullDay) when = sameDay ? "TODAY" : e.start.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short" });
      else if (sameDay) when = e.start.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).replace(" ", "");
      else when = e.start.toLocaleDateString("en-US", { timeZone: tz, weekday: "short" });
      return `${when.padEnd(7)} ${summary}`.slice(0, size.cols);
    });
    return [title, ...lines].join("\n");
  } catch {
    return `${title}\nCALENDAR UNAVAILABLE`;
  }
}
