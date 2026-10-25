// Board model shared by the player, the control app and the API.
// A cell holds one character from CHARSET, or a color tile written as "{red}".

export const COLORS = {
  red: "#d6453d",
  orange: "#e8833a",
  yellow: "#f2c53d",
  green: "#3fa66a",
  blue: "#3b7dd8",
  violet: "#8a5cc7",
  white: "#f4f1ea",
} as const;

export type ColorName = keyof typeof COLORS;

const CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&()-+=;:'\",./?°";

// The order a flap steps through. Color tiles sit after the characters,
// so going from a letter to a color flips through the rest of the drum.
export const CHARSET: string[] = [
  ...CHARS.split(""),
  ...Object.keys(COLORS).map((c) => `{${c}}`),
];

export const MIN_ROWS = 2;
export const MAX_ROWS = 16;
export const MIN_COLS = 8;
export const MAX_COLS = 48;

export type Grid = string[][];

export function isColor(cell: string): cell is `{${ColorName}}` {
  return cell.length > 2 && cell.startsWith("{") && cell.endsWith("}");
}

// Split markup into cells: "{red}HI" -> ["{red}", "H", "I"].
// Unknown characters become spaces; unknown {tags} are dropped.
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    if (ch === "{") {
      const end = upper.indexOf("}", i);
      if (end > i) {
        const name = upper.slice(i + 1, end).toLowerCase();
        if (name in COLORS) out.push(`{${name}}`);
        i = end;
        continue;
      }
    }
    if (ch === "\n") {
      out.push("\n");
      continue;
    }
    out.push(CHARS.includes(ch) ? ch : " ");
  }
  return out;
}

export type Align = "left" | "center";

// Word-wrap markup into a rows x cols grid, centered vertically.
export function layout(
  text: string,
  rows: number,
  cols: number,
  align: Align = "center",
): Grid {
  const lines: string[][] = [];
  for (const para of splitLines(tokenize(text))) {
    let line: string[] = [];
    for (const word of splitWords(para)) {
      const need = line.length === 0 ? word.length : line.length + 1 + word.length;
      if (need <= cols) {
        if (line.length > 0) line.push(" ");
        line.push(...word);
        continue;
      }
      if (line.length > 0) lines.push(line);
      // A word longer than the board is hard-broken.
      let rest = word;
      while (rest.length > cols) {
        lines.push(rest.slice(0, cols));
        rest = rest.slice(cols);
      }
      line = [...rest];
    }
    lines.push(line);
  }

  const used = lines.slice(0, rows);
  const top = Math.floor((rows - used.length) / 2);
  const grid: Grid = Array.from({ length: rows }, () => Array(cols).fill(" "));
  used.forEach((line, r) => {
    const left = align === "center" ? Math.floor((cols - line.length) / 2) : 0;
    line.forEach((cell, c) => {
      grid[top + r][left + c] = cell;
    });
  });
  return grid;
}

function splitLines(tokens: string[]): string[][] {
  const out: string[][] = [[]];
  for (const t of tokens) {
    if (t === "\n") out.push([]);
    else out[out.length - 1].push(t);
  }
  return out;
}

function splitWords(tokens: string[]): string[][] {
  const out: string[][] = [];
  let word: string[] = [];
  for (const t of tokens) {
    if (t === " ") {
      if (word.length) out.push(word);
      word = [];
    } else {
      word.push(t);
    }
  }
  if (word.length) out.push(word);
  return out;
}

export function clampSize(rows: number, cols: number) {
  return {
    rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.round(rows) || 6)),
    cols: Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(cols) || 22)),
  };
}
