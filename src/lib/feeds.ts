import type { PlaylistItem } from "./db";

// Feeds render to board markup on the server, so the player only ever
// receives text. Each returns at most a few short lines.

export async function renderItem(item: PlaylistItem): Promise<string> {
  switch (item.kind) {
    case "text":
      return item.text;
    case "time":
      return renderTime(item.timezone);
    case "weather":
      return renderWeather(item.place, item.lat, item.lon);
  }
}

function renderTime(timezone?: string): string {
  const now = new Date();
  const tz = timezone || process.env.DEFAULT_TIMEZONE || "America/Los_Angeles";
  const day = now.toLocaleDateString("en-US", { timeZone: tz, weekday: "long" });
  const date = now.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const time = now.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  return `${day}\n${date}\n${time}`;
}

// Open-Meteo needs no API key. https://open-meteo.com/en/docs
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
    const res = await fetch(url, { next: { revalidate: 600 } });
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
