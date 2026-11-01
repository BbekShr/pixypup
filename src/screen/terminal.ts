import { createHash } from 'node:crypto';
import type { Box } from './decide';
import type { Run } from './helper';
import type { Win } from './window-list';

// Runs `osascript <args>`; null on any failure. Injected by main.
export type Osa = (args: string[], timeoutMs: number) => Promise<string | null>;
export type Decoded = { data: Uint8Array; w: number; h: number; channels: number };

const FAIL =
  /\bFAIL(ED)?\b|✗|✖|✕|^\s*×|\b\w*Error:|^\s*\w*Error\b|\berror TS\d+|\b\d+ (failed|failing)\b|^\s*Found \d+ errors?\b|^\s*error\[E\d+\]: |^\s*error: could not compile\b/;
const ZERO = /\b0 (failed|failing|errors?)\b|\bno errors?\b/gi;
const ESLINT_OK = /^\s*✖ \d+ problems? \(0 errors/;

export function findFailure(lines: string[]): { lineIndex: number; text: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!ESLINT_OK.test(l) && FAIL.test(l.replace(ZERO, ''))) return { lineIndex: i, text: l };
  }
  return null;
}

// A run's all-green summary (vitest, jest, pytest, mocha, tsc --watch). A line that also says "failed" is not green.
const PASS = /\b\d+ (passed|passing)\b|^\s*PASS\b|\bFound 0 errors\b|\ball tests passed\b/i;

export function findPass(lines: string[]): number | null {
  for (let i = lines.length - 1; i >= 0; i--) if (PASS.test(lines[i]) && !findFailure([lines[i]])) return i;
  return null;
}

/** Green only when the newest result on screen is a pass: an old failure above it is history. */
export const greenAfter = (lines: string[], failIndex: number | null): boolean => {
  const p = findPass(lines);
  return p !== null && (failIndex === null || p > failIndex);
};

const CONTEXT_LINES = 16;
const CONTEXT_CHARS = 1200;

/** The failure's own story (assertion, expected/received, file:line): from the FIRST failing line, a few lines on. */
export function failureContext(lines: string[]): string {
  const first = lines.findIndex((l) => findFailure([l]) !== null);
  if (first < 0) return '';
  const text = lines.slice(first, first + CONTEXT_LINES).map(clean).filter(Boolean).join('\n');
  return Array.from(text).slice(0, CONTEXT_CHARS).join('');
}

export function lineToScreen(
  b: Box,
  rows: number,
  lineIndex: number,
  titleBarPts = 28,
  padPts = 4,
): Box {
  const rowH = (b.h - titleBarPts - 2 * padPts) / rows;
  return {
    x: b.x + padPts,
    y: b.y + titleBarPts + padPts + lineIndex * rowH,
    w: b.w - 2 * padPts,
    h: rowH,
  };
}

// Red-dominant pixels (docs/POSE-TEST.md) grouped into line boxes, in image pixels.
export function findRedLines(
  rgba: Uint8Array,
  w: number,
  h: number,
  channels: number,
  fromY = 0,
): Box[] {
  const MIN_PX = 3;
  const GAP = 2;
  const boxes: Box[] = [];
  let cur: { y0: number; y1: number; x0: number; x1: number } | null = null;
  const flush = () => {
    if (cur) boxes.push({ x: cur.x0, y: cur.y0, w: cur.x1 - cur.x0 + 1, h: cur.y1 - cur.y0 + 1 });
    cur = null;
  };
  for (let y = fromY; y < h; y++) {
    let n = 0;
    let x0 = w;
    let x1 = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const r = rgba[i];
      if (r > 180 && r - rgba[i + 1] > 80 && r - rgba[i + 2] > 80) {
        n++;
        if (x < x0) x0 = x;
        x1 = x;
      }
    }
    if (n >= MIN_PX) {
      if (cur && y - cur.y1 <= GAP + 1) {
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, x0);
        cur.x1 = Math.max(cur.x1, x1);
      } else {
        flush();
        cur = { y0: y, y1: y, x0, x1 };
      }
    }
  }
  flush();
  return boxes;
}

const OWN = ['PixyPup', 'Electron'];
const TAB_BAR_PTS = 25;
const TITLE_BAR_PTS = 28;

// The helper lists layer-0 windows front to back; sniff only what the user is looking at.
export function pickTerminal(windows: Win[]): Win | null {
  const front = windows.find((w) => !OWN.includes(w.owner));
  return front && (front.owner === 'Terminal' || front.owner === 'iTerm2') ? front : null;
}

// Full-screen windows (no title bar) are unsupported: the geometry would be off by the title bar.
const HEAD =
  'return (nRows as text) & linefeed & (nCols as text) & linefeed & (tabCount as text) & linefeed & (winId as text) & linefeed & (item 1 of b as text) & linefeed & (item 2 of b as text) & linefeed & (item 3 of b as text) & linefeed & (item 4 of b as text) & linefeed & txt';
// `contents of <variable>` is AppleScript's dereference operator: it returns the tab object, not its text, and the
// final `& txt` then fails (-1700). Ask the tab itself for its contents.
export const SCRIPTS: Record<string, string> = {
  Terminal: `tell application "Terminal"
set t to selected tab of front window
set nRows to number of rows of t
set nCols to number of columns of t
set tabCount to count of tabs of front window
set winId to id of front window
set b to bounds of front window
set txt to contents of selected tab of front window
${HEAD}
end tell`,
  // iTerm2's window id is not a CGWindowID, so 0 = unknown; bounds decide.
  iTerm2: `tell application "iTerm2"
tell current session of current window
set nRows to rows
set nCols to columns
set txt to contents
end tell
set tabCount to count of tabs of current window
set winId to 0
set b to bounds of current window
${HEAD}
end tell`,
};

export type Visible = {
  lines: string[];
  rowOf: number[];
  rows: number;
  tabs: number;
  winId: number;
  bounds: Box;
};

const int = (s: string, lo: number, hi: number) => {
  const n = Number(s.trim());
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

// Output: rows, columns, tabs, window id, left, top, right, bottom, then the contents.
export function parseVisible(out: string): Visible | null {
  const parts = out.split('\n');
  if (parts.length < 9) return null;
  const rows = int(parts[0], 1, 500);
  const cols = int(parts[1], 1, 1000);
  const tabs = int(parts[2], 1, 100);
  const winId = int(parts[3], 0, 2 ** 32);
  const [bl, bt, br, bb] = [4, 5, 6, 7].map((i) => int(parts[i], -100000, 100000));
  if (rows === null || cols === null || tabs === null || winId === null) return null;
  if (bl === null || bt === null || br === null || bb === null || br <= bl || bb <= bt) return null;
  const all = parts.slice(8).join('\n').replace(/\n+$/, '').split('\n');
  const height = (l: string) => Math.max(1, Math.ceil([...l].length / cols));
  // Visible tail: fill `rows` screen rows from the bottom, counting wrapped lines at full height.
  let used = 0;
  let start = all.length;
  while (start > 0 && used + height(all[start - 1]) <= rows) used += height(all[--start]);
  const lines = all.slice(start);
  const rowOf: number[] = [];
  let r = 0;
  for (const l of lines) {
    rowOf.push(r);
    r += height(l);
  }
  return { lines, rowOf, rows, tabs, winId, bounds: { x: bl, y: bt, w: br - bl, h: bb - bt } };
}

// Same window in a different id space: the AppleScript rectangle must cover the CG one.
export function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(a.w * a.h, b.w * b.h) : 0;
}

export function clean(text: string): string {
  const ok = (c: string) => {
    const n = c.charCodeAt(0);
    return !(n < 32 || (n >= 127 && n <= 159));
  };
  return Array.from(text)
    .map((c) => (ok(c) ? c : ' '))
    .join('')
    .replace(/\p{Cf}/gu, '')
    .trim();
}

const truncate = (s: string) => Array.from(s).slice(0, 200).join('');

export type TerminalDeps = {
  run: Run;
  osa: Osa;
  windows: Win[];
  decodePng?: (png: Buffer) => Promise<Decoded | null>;
};
export type TerminalRead = {
  terminalError: { text: string; box: Box; context: string } | null;
  /** The newest result on screen is an all-green run. */
  terminalPass: boolean;
  changed: boolean;
  key: string;
};

async function redBox(deps: TerminalDeps, win: Win, chromePts: number): Promise<Box | null> {
  if (!deps.decodePng) return null;
  const r = await deps.run(['capture', String(win.id)], { binary: true });
  if (r.code !== 0) return null;
  const img = await deps.decodePng(r.stdout);
  if (!img) return null;
  const s = img.w / win.bounds.w;
  // Start below the title bar and tab bar: the close button is red.
  const last = findRedLines(img.data, img.w, img.h, img.channels, Math.ceil(chromePts * s)).at(-1);
  if (!last) return null;
  return {
    x: win.bounds.x + last.x / s,
    y: win.bounds.y + last.y / s,
    w: last.w / s,
    h: last.h / s,
  };
}

export function createTerminalReader() {
  let prev = '';
  return async (deps: TerminalDeps): Promise<TerminalRead> => {
    const done = (found: { text: string; box: Box; context: string } | null, terminalPass = false): TerminalRead => {
      const key = found
        ? createHash('sha1').update(found.text).digest('hex')
        : '';
      const changed = key !== prev;
      prev = key;
      return { terminalError: found, terminalPass, changed, key };
    };
    const win = pickTerminal(deps.windows);
    const script = win && SCRIPTS[win.owner];
    if (!win || !script) return done(null);
    const out = await deps.osa(['-e', script], 3000);
    const vis = out && parseVisible(out);
    // A failed read is "unknown", not "no failure": keep the previous key so the loop does not forget the last sniff.
    if (!vis) return { terminalError: null, terminalPass: false, changed: false, key: prev };
    // The id is advisory (CGWindowID may not equal the AppleScript id); bounds decide.
    const sameId = vis.winId !== 0 && vis.winId === win.id;
    if (!sameId && overlap(vis.bounds, win.bounds) < 0.8) return done(null);
    const asWin = { ...win, bounds: vis.bounds };
    const f = findFailure(vis.lines);
    if (greenAfter(vis.lines, f?.lineIndex ?? null)) return done(null, true);
    if (!f) return done(null);
    const chrome = TITLE_BAR_PTS + (vis.tabs > 1 ? TAB_BAR_PTS : 0);
    const textBox = lineToScreen(vis.bounds, vis.rows, vis.rowOf[f.lineIndex], chrome);
    const red = await redBox(deps, asWin, chrome);
    const box = red && Math.abs(red.y - textBox.y) <= 1.5 * textBox.h ? red : textBox;
    return done({ text: truncate(clean(f.text)), box, context: failureContext(vis.lines) });
  };
}
