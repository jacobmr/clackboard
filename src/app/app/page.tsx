"use client";

import { useCallback, useEffect, useState } from "react";
import Board from "@/components/Board";
import { layout } from "@/lib/board";
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
  if (!authed) return <Login onDone={load} />;

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

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <main className={styles.main}>
      <h1>Clackboard</h1>
      <form
        className={styles.row}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button>Sign in</button>
      </form>
      {error && <p className={styles.error}>{error}</p>}
    </main>
  );
}

function Pair({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  return (
    <section className={styles.card}>
      <h2>Pair a screen</h2>
      <form
        className={styles.row}
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api("/api/screens/claim", { method: "POST", body: JSON.stringify({ code, name }) });
            setCode("");
            setName("");
            onPaired();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <input placeholder="Code on TV" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input placeholder="Name, e.g. Kitchen" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={code.length !== 6}>Pair</button>
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

  const patch = async (body: Record<string, unknown>) => {
    const { screen: s } = await api<{ screen: Screen }>(`/api/screens/${screen.id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    onChange(s);
  };

  const edit = (i: number, item: PlaylistItem) => {
    setPlaylist((p) => p.map((x, j) => (j === i ? item : x)));
    setSaved(false);
  };

  const preview = layout(draft || playlist.find((p) => p.kind === "text")?.text || "", screen.rows, screen.cols, screen.align);

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <h2>{screen.name}</h2>
        <span className={styles.muted}>{screen.lastSeen ? `seen ${ago(screen.lastSeen)}` : "never seen"}</span>
      </div>

      <div className={styles.preview}>
        <Board grid={preview} theme={screen.theme} fit="container" />
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
