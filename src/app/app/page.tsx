"use client";

import { useCallback, useEffect, useState } from "react";
import Board from "@/components/Board";
import { layout } from "@/lib/board";
import { parseVideo } from "@/lib/video";
import type { PlaylistItem, Screen } from "@/lib/db";
import styles from "./app.module.css";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? res.statusText), { status: res.status });
  return body as T;
}

export default function ControlApp() {
  const [screens, setScreens] = useState<Screen[] | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    try {
      const { screens } = await api<{ screens: Screen[] }>("/api/screens");
      setScreens(screens);
      setAuthed(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setAuthed(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (authed === null) return <main className={styles.main} />;
  if (!authed) return <Start onDone={load} />;

  const replace = (s: Screen) => setScreens((all) => all?.map((x) => (x.id === s.id ? s : x)) ?? null);

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1>Clackboard</h1>
        <button
          className={styles.link}
          onClick={async () => {
            await api("/api/logout", { method: "POST" });
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>
      <Pair onPaired={load} />
      {screens?.length === 0 && <p className={styles.muted}>No screens yet. Open /player on a TV to get a code.</p>}
      {screens?.map((s) => (
        <ScreenCard key={s.id} screen={s} onChange={replace} onRemoved={load} />
      ))}
    </main>
  );
}

// Not signed in: the code on a TV is the way in. No passwords.
function Start({ onDone }: { onDone: () => void }) {
  return (
    <main className={styles.main}>
      <h1>Clackboard</h1>
      <Pair onPaired={onDone} title="Enter the code on your TV" />
      <p className={styles.muted}>
        New TV: open clackboard.fyi/player on it and type the code it shows, or scan its QR code.
        <br />
        TV already set up: unplug it and plug it back in (or reload its page). For 2 minutes it shows a
        sign-in code.
      </p>
    </main>
  );
}

function Pair({ onPaired, title = "Pair a screen" }: { onPaired: () => void; title?: string }) {
  // A QR code on the TV opens /app?code=XXXXXX.
  const [code, setCode] = useState(() =>
    typeof window === "undefined" ? "" : (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase(),
  );
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <section className={styles.card}>
      <h2>{title}</h2>
      <form
        className={styles.row}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api("/api/screens/claim", { method: "POST", body: JSON.stringify({ code, name }) });
            setCode("");
            setName("");
            if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
            onPaired();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input placeholder="Code on TV" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input placeholder="Name if new, e.g. Kitchen" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={code.length !== 6}>Go</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}

function ScreenCard({
  screen,
  onChange,
  onRemoved,
}: {
  screen: Screen;
  onChange: (s: Screen) => void;
  onRemoved: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [seconds, setSeconds] = useState(300);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(screen.playlist);
  const [saved, setSaved] = useState(true);
  const [rendered, setRendered] = useState<string[]>([]);

  // Preview the playlist as the TV renders it, feeds included.
  useEffect(() => {
    api<{ rendered: string[] }>(`/api/screens/${screen.id}`)
      .then((r) => setRendered(r.rendered))
      .catch(() => undefined);
  }, [screen.id, screen.version]);

  const patch = async (body: Record<string, unknown>) => {
    const { screen: s } = await api<{ screen: Screen }>(`/api/screens/${screen.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    onChange(s);
  };

  // i === playlist.length appends.
  const edit = (i: number, item: PlaylistItem) => {
    setPlaylist((p) => (i >= p.length ? [...p, item] : p.map((x, j) => (j === i ? item : x))));
    setSaved(false);
  };

  const preview = layout(draft || rendered[0] || "", screen.rows, screen.cols, screen.align);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{screen.name}</h2>
        <span className={styles.muted}>{screen.lastSeen ? `seen ${ago(screen.lastSeen)}` : "never seen"}</span>
      </div>

      <div className={styles.preview}>
        <Board grid={preview} theme={screen.theme} fit="container" />
      </div>

      <div className={styles.row}>
        <button onClick={() => api(`/api/screens/${screen.id}/skip`, { method: "POST" })}>Skip</button>
        <button className={styles.secondary} onClick={() => patch({ paused: !screen.paused })}>
          {screen.paused ? "Resume" : "Pause"}
        </button>
        <span className={styles.muted}>
          {screen.paused ? "Paused: the TV holds one message, videos stopped." : "The TV follows within 4 s."}
        </span>
      </div>

      <h3>Send now</h3>
      <textarea
        rows={3}
        placeholder="Type a message. Colors: {red} {orange} {yellow} {green} {blue} {violet} {white}"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className={styles.row}>
        <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
          <option value={60}>1 minute</option>
          <option value={300}>5 minutes</option>
          <option value={3600}>1 hour</option>
          <option value={0}>Until cleared</option>
        </select>
        <button
          disabled={!draft.trim()}
          onClick={async () => {
            await api(`/api/screens/${screen.id}/send`, { method: "POST", body: JSON.stringify({ text: draft, seconds }) });
            setDraft("");
          }}
        >
          Send
        </button>
        <button className={styles.secondary} onClick={() => api(`/api/screens/${screen.id}/send`, { method: "DELETE" })}>
          Clear
        </button>
      </div>

      <h3>Playlist</h3>
      {playlist.map((item, i) => (
        <PlaylistRow
          key={i}
          item={item}
          onChange={(it) => edit(i, it)}
          onRemove={() => {
            setPlaylist((p) => p.filter((_, j) => j !== i));
            setSaved(false);
          }}
        />
      ))}
      <div className={styles.row}>
        <button className={styles.secondary} onClick={() => edit(playlist.length, { kind: "text", text: "", seconds: 20 })}>
          + Message
        </button>
        <button className={styles.secondary} onClick={() => edit(playlist.length, { kind: "time", seconds: 20 })}>
          + Time
        </button>
        <button
          className={styles.secondary}
          onClick={() => edit(playlist.length, { kind: "weather", seconds: 20, place: "PORTLAND", lat: 45.52, lon: -122.68 })}
        >
          + Weather
        </button>
        <button
          className={styles.secondary}
          onClick={() => edit(playlist.length, { kind: "ha", seconds: 20, title: "HOME", entities: [{ id: "", label: "" }] })}
        >
          + Home Assistant
        </button>
        <button
          className={styles.secondary}
          onClick={() => edit(playlist.length, { kind: "calendar", seconds: 20, title: "TODAY", url: "", days: 1 })}
        >
          + Calendar
        </button>
        <button className={styles.secondary} onClick={() => edit(playlist.length, { kind: "video", seconds: 60, url: "" })}>
          + Video
        </button>
        <button
          disabled={saved}
          onClick={async () => {
            await patch({ playlist });
            setSaved(true);
          }}
        >
          Save playlist
        </button>
      </div>

      <details>
        <summary>Settings</summary>
        <div className={styles.settings}>
          <label>
            Rows
            <input type="number" defaultValue={screen.rows} min={2} max={16} onBlur={(e) => patch({ rows: Number(e.target.value) })} />
          </label>
          <label>
            Columns
            <input type="number" defaultValue={screen.cols} min={8} max={48} onBlur={(e) => patch({ cols: Number(e.target.value) })} />
          </label>
          <label>
            Align
            <select value={screen.align} onChange={(e) => patch({ align: e.target.value })}>
              <option value="center">Center</option>
              <option value="left">Left</option>
            </select>
          </label>
          <label>
            Theme
            <select value={screen.theme} onChange={(e) => patch({ theme: e.target.value })}>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>
          <label className={styles.check}>
            <input type="checkbox" checked={screen.sound} onChange={(e) => patch({ sound: e.target.checked })} />
            Flap sound
          </label>
          <label>
            Name
            <input defaultValue={screen.name} onBlur={(e) => patch({ name: e.target.value })} />
          </label>
          <p className={styles.muted}>
            API: <code>POST /api/screens/{screen.id}/send</code>
          </p>
          <button
            className={styles.danger}
            onClick={async () => {
              await api(`/api/screens/${screen.id}`, { method: "DELETE" });
              onRemoved();
            }}
          >
            Remove screen
          </button>
        </div>
      </details>
    </section>
  );
}

function PlaylistRow({
  item,
  onChange,
  onRemove,
}: {
  item: PlaylistItem;
  onChange: (item: PlaylistItem) => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.item}>
      {item.kind === "text" && (
        <textarea rows={2} value={item.text} onChange={(e) => onChange({ ...item, text: e.target.value })} />
      )}
      {item.kind === "time" && <span>Time and date</span>}
      {item.kind === "weather" && (
        <div className={styles.row}>
          <input value={item.place} onChange={(e) => onChange({ ...item, place: e.target.value })} />
          <input type="number" step="0.01" value={item.lat} onChange={(e) => onChange({ ...item, lat: Number(e.target.value) })} />
          <input type="number" step="0.01" value={item.lon} onChange={(e) => onChange({ ...item, lon: Number(e.target.value) })} />
        </div>
      )}
      {item.kind === "ha" && (
        <>
          <input value={item.title} placeholder="Title" onChange={(e) => onChange({ ...item, title: e.target.value })} />
          {item.entities.map((ent, i) => {
            const set = (next: { id: string; label: string } | null) =>
              onChange({
                ...item,
                entities: next ? item.entities.map((x, j) => (j === i ? next : x)) : item.entities.filter((_, j) => j !== i),
              });
            return (
              <div key={i} className={styles.row}>
                <input placeholder="binary_sensor.front_door" value={ent.id} onChange={(e) => set({ ...ent, id: e.target.value })} />
                <input placeholder="Label" value={ent.label} onChange={(e) => set({ ...ent, label: e.target.value })} />
                <button className={styles.link} onClick={() => set(null)}>
                  ×
                </button>
              </div>
            );
          })}
          <button
            className={styles.link}
            onClick={() => onChange({ ...item, entities: [...item.entities, { id: "", label: "" }] })}
          >
            + entity
          </button>
        </>
      )}
      {item.kind === "calendar" && (
        <div className={styles.row}>
          <input value={item.title} placeholder="Title" onChange={(e) => onChange({ ...item, title: e.target.value })} />
          <input
            placeholder="iCal URL (Google: Settings > Secret address in iCal format)"
            value={item.url}
            onChange={(e) => onChange({ ...item, url: e.target.value })}
          />
          <select value={item.days} onChange={(e) => onChange({ ...item, days: Number(e.target.value) })}>
            <option value={1}>Next 24 h</option>
            <option value={3}>Next 3 days</option>
            <option value={7}>Next 7 days</option>
          </select>
        </div>
      )}
      {item.kind === "video" && (
        <>
          <input
            placeholder="YouTube or Vimeo link"
            value={item.url}
            onChange={(e) => onChange({ ...item, url: e.target.value })}
          />
          {item.url && !parseVideo(item.url) && <p className={styles.error}>Not a YouTube or Vimeo video link</p>}
          <label className={styles.row}>
            Size
            <select value={item.size ?? 100} onChange={(e) => onChange({ ...item, size: Number(e.target.value) })}>
              <option value={100}>Full screen</option>
              <option value={75}>Large (3/4)</option>
              <option value={50}>Medium (1/2)</option>
              <option value={33}>Small (1/3)</option>
            </select>
          </label>
          <p className={styles.muted}>
            Pi 4 TV: plays with sound. TV or laptop browser: plays muted until someone clicks the page once. Pi
            Zero W: skipped.
          </p>
        </>
      )}
      <div className={styles.row}>
        <input
          className={styles.secs}
          type="number"
          min={5}
          value={item.seconds}
          onChange={(e) => onChange({ ...item, seconds: Number(e.target.value) })}
        />
        <span className={styles.muted}>sec</span>
        <button className={styles.link} onClick={onRemove}>
          Remove
        </button>
      </div>
    </div>
  );
}

function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
