import { createHash } from 'node:crypto';
import type { Box } from './decide';
import type { Run } from './helper';
import type { Win } from './window-list';

// Runs `osascript <args>`; null on any failure. Injected by main.
export type Osa = (args: string[], timeoutMs: number) => Promise<string | null>;
export type Decoded = { data: Uint8Array; w: number; h: number; channels: number };

const FAIL = /\bFAIL(ED)?\b|✗|✖|×|\bError\b|AssertionError|\berror TS\d+|\b\d+ failed\b/;
const NOT_FAIL = /\b0 failed\b|no errors?\b/i;

export function findFailure(lines: string[]): { lineIndex: number; text: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (FAIL.test(lines[i]) && !NOT_FAIL.test(lines[i])) return { lineIndex: i, text: lines[i] };
  }
  return null;
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
export function findRedLines(rgba: Uint8Array, w: number, h: number, channels: number): Box[] {
  const MIN_PX = 3;
  const GAP = 2;
  const boxes: Box[] = [];
  let cur: { y0: number; y1: number; x0: number; x1: number } | null = null;
  const flush = () => {
    if (cur) boxes.push({ x: cur.x0, y: cur.y0, w: cur.x1 - cur.x0 + 1, h: cur.y1 - cur.y0 + 1 });
    cur = null;
  };
  for (let y = 0; y < h; y++) {
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

export function pickTerminal(windows: Win[]): Win | null {
  // The helper lists layer-0 windows front to back.
  return windows.find((w) => w.owner === 'Terminal' || w.owner === 'iTerm2') ?? null;
}

// Rows first, then a newline, then the contents: unambiguous whatever the terminal text holds.
const SCRIPTS: Record<string, string> = {
  Terminal:
    'tell application "Terminal" to tell selected tab of front window to return ((number of rows) as text) & linefeed & contents',
  iTerm2:
    'tell application "iTerm2" to tell current session of current window to return (rows as text) & linefeed & contents',
};

export function parseVisible(out: string): { lines: string[]; rows: number } | null {
  const nl = out.indexOf('\n');
  if (nl < 0) return null;
  const rows = Number(out.slice(0, nl).trim());
  if (!Number.isInteger(rows) || rows < 1 || rows > 500) return null;
  const lines = out.slice(nl + 1).replace(/\n+$/, '').split('\n');
  return { lines: lines.slice(-rows), rows };
}

export function clean(text: string): string {
  const ctl = (c: string) => {
    const n = c.charCodeAt(0);
    return n < 32 || (n >= 127 && n <= 159);
  };
  return [...text].map((c) => (ctl(c) ? ' ' : c)).join('').trim().slice(0, 200);
}

export type TerminalDeps = {
  run: Run;
  osa: Osa;
  windows: Win[];
  decodePng?: (png: Buffer) => Promise<Decoded | null>;
};
export type TerminalRead = {
  terminalError: { text: string; box: Box } | null;
  changed: boolean;
  key: string;
};

async function redBox(deps: TerminalDeps, win: Win): Promise<Box | null> {
  if (!deps.decodePng) return null;
  const r = await deps.run(['capture', String(win.id)], { binary: true });
  if (r.code !== 0) return null;
  const img = await deps.decodePng(r.stdout);
  if (!img) return null;
  const last = findRedLines(img.data, img.w, img.h, img.channels).at(-1);
  if (!last) return null;
  const s = img.w / win.bounds.w;
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
    const done = (found: { text: string; box: Box } | null): TerminalRead => {
      const key = found
        ? createHash('sha1')
            .update(`${found.text}|${[found.box.x, found.box.y, found.box.w, found.box.h].map((n) => Math.round(n / 4)).join(',')}`)
            .digest('hex')
        : '';
      const changed = key !== prev;
      prev = key;
      return { terminalError: found, changed, key };
    };
    const win = pickTerminal(deps.windows);
    const script = win && SCRIPTS[win.owner];
    if (!win || !script) return done(null);
    const out = await deps.osa(['-e', script], 3000);
    const vis = out && parseVisible(out);
    if (!vis) return done(null);
    const f = findFailure(vis.lines);
    if (!f) return done(null);
    const box = (await redBox(deps, win)) ?? lineToScreen(win.bounds, vis.rows, f.lineIndex);
    return done({ text: clean(f.text), box });
  };
}
