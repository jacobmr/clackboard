"use client";

import { useEffect, useRef, useState } from "react";
import { CHARSET, COLORS, isColor, type Grid } from "@/lib/board";
import styles from "./Board.module.css";

const STEP_MS = 65;

// --- sound -------------------------------------------------------------
// A short filtered noise burst per flap, synthesized so we ship no audio files.
let audio: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let lastClick = 0;

export function enableSound() {
  if (audio) return;
  audio = new AudioContext();
  const len = Math.floor(audio.sampleRate * 0.012);
  noise = audio.createBuffer(1, len, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
}

function click() {
  if (!audio || !noise || audio.state !== "running") return;
  const now = performance.now();
  // Many flaps land together; one click per few ms reads as a clatter, not a roar.
  if (now - lastClick < 6) return;
  lastClick = now;
  const src = audio.createBufferSource();
  src.buffer = noise;
  const filter = audio.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1800 + Math.random() * 1600;
  filter.Q.value = 1.2;
  const gain = audio.createGain();
  gain.gain.value = 0.35;
  src.connect(filter).connect(gain).connect(audio.destination);
  src.start();
}

// --- cells -------------------------------------------------------------

function Face({ value }: { value: string }) {
  if (isColor(value)) {
    const color = COLORS[value.slice(1, -1) as keyof typeof COLORS];
    return <span className={styles.tile} style={{ background: color }} />;
  }
  return <span className={styles.glyph}>{value === " " ? " " : value}</span>;
}

function Cell({ target, sound }: { target: string; sound: boolean }) {
  const [index, setIndex] = useState(0);
  const [prev, setPrev] = useState(0);
  const [step, setStep] = useState(0);
  const goal = Math.max(0, CHARSET.indexOf(target));

  useEffect(() => {
    if (index === goal) return;
    const t = setTimeout(() => {
      setPrev(index);
      setIndex((index + 1) % CHARSET.length);
      setStep((s) => s + 1);
      if (sound) click();
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [index, goal, sound]);

  const now = CHARSET[index];
  const before = CHARSET[prev];
  return (
    <div className={styles.cell}>
      <div className={`${styles.half} ${styles.top}`}>
        <Face value={now} />
      </div>
      <div className={`${styles.half} ${styles.bottom}`}>
        <Face value={step ? before : now} />
      </div>
      {step > 0 && (
        <>
          <div key={`a${step}`} className={`${styles.half} ${styles.top} ${styles.leafTop}`}>
            <Face value={before} />
          </div>
          <div key={`b${step}`} className={`${styles.half} ${styles.bottom} ${styles.leafBottom}`}>
            <Face value={now} />
          </div>
        </>
      )}
    </div>
  );
}

// --- board -------------------------------------------------------------

export default function Board({
  grid,
  sound = false,
  theme = "dark",
  fit = "screen",
}: {
  grid: Grid;
  sound?: boolean;
  theme?: "dark" | "light";
  fit?: "screen" | "container";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const [cell, setCell] = useState(20);

  // Size cells so the whole board fits its box at a 1 : 1.45 cell ratio.
  useEffect(() => {
    const el = fit === "screen" ? null : ref.current?.parentElement;
    const measure = () => {
      const w = el ? el.clientWidth : window.innerWidth * 0.96;
      const h = el ? el.clientWidth * 0.6 : window.innerHeight * 0.9;
      const gap = 0.12;
      const byW = w / (cols * (1 + gap));
      const byH = h / (rows * (1.45 + gap));
      setCell(Math.max(6, Math.floor(Math.min(byW, byH))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el ?? document.body);
    return () => ro.disconnect();
  }, [rows, cols, fit]);

  return (
    <div
      ref={ref}
      className={`${styles.board} ${theme === "light" ? styles.light : ""}`}
      style={{ "--cell": `${cell}px`, gridTemplateColumns: `repeat(${cols}, var(--cell))` } as React.CSSProperties}
      aria-label={grid.map((r) => r.join("")).join(" ")}
    >
      {grid.flatMap((row, r) => row.map((c, i) => <Cell key={`${r}-${i}`} target={c} sound={sound} />))}
    </div>
  );
}
