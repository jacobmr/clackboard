"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Board, { enableSound } from "@/components/Board";
import { layout, type Align } from "@/lib/board";
import styles from "./player.module.css";

const TOKEN_KEY = "clackboard.device";
const POLL_MS = 4000;

type Config = { rows: number; cols: number; align: Align; theme: "dark" | "light"; sound: boolean };
type State =
  | { paired: false; code: string; config: Config }
  | {
      paired: true;
      name: string;
      config: Config;
      override: { text: string; until: number } | null;
      items: { seconds: number; text: string }[];
    };

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the screen re-pairs after a reload.
  }
}

export default function Player() {
  const [state, setState] = useState<State | null>(null);
  const [index, setIndex] = useState(0);
  const [soundOn, setSoundOn] = useState(false);
  const token = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (!token.current) {
      token.current = readToken();
      if (!token.current) {
        const res = await fetch("/api/devices", { method: "POST" });
        token.current = (await res.json()).deviceToken;
        writeToken(token.current);
      }
    }
    const res = await fetch(`/api/player?token=${encodeURIComponent(token.current!)}`, { cache: "no-store" });
    if (res.status === 404) {
      // The screen was removed in the app: start over with a new code.
      token.current = null;
      writeToken(null);
      return poll();
    }
    if (res.ok) setState(await res.json());
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => poll().catch(() => undefined).finally(() => alive && setTimeout(tick, POLL_MS));
    tick();
    return () => {
      alive = false;
    };
  }, [poll]);

  // Keep the TV awake where the browser allows it.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => undefined);
    return () => void lock?.release();
  }, []);

  // Rotate through the playlist.
  // Every poll returns a fresh array, so the timer keys on the durations only;
  // otherwise each poll would restart the current item's countdown.
  const items = useMemo(() => (state?.paired ? state.items : []), [state]);
  const durations = items.map((i) => i.seconds).join(",");
  useEffect(() => {
    const secs = durations ? durations.split(",").map(Number) : [];
    if (secs.length === 0) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % secs.length), secs[index % secs.length] * 1000);
    return () => clearTimeout(t);
  }, [index, durations]);

  const text = useMemo(() => {
    if (!state) return "";
    if (!state.paired) {
      const host = typeof window === "undefined" ? "" : window.location.host;
      return `PAIR THIS SCREEN\n{yellow} ${state.code} {yellow}\n${host}/APP`;
    }
    if (state.override) return state.override.text;
    return items.length ? items[index % items.length].text : "";
  }, [state, items, index]);

  if (!state) return <main className={styles.main} />;

  const { rows, cols, align, theme, sound } = state.config;
  const grid = layout(text, rows, cols, state.paired ? align : "center");

  const startSound = () => {
    enableSound();
    setSoundOn(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <main className={`${styles.main} ${theme === "light" ? styles.light : ""}`} onClick={startSound}>
      <Board grid={grid} sound={sound && soundOn} theme={theme} />
      {sound && !soundOn && <p className={styles.hint}>Tap for sound and full screen</p>}
    </main>
  );
}
