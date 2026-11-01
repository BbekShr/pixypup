import type { Box } from './decide';
import { parseJson, type Run } from './helper';

export type Win = { id: number; pid: number; owner: string; title: string; bounds: Box };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

export function parseWindows(json: unknown): { windows: Win[]; titlesRedacted: boolean } {
  const j = isObj(json) ? json : {};
  const rows = Array.isArray(j.windows) ? j.windows : [];
  const windows: Win[] = [];
  for (const r of rows) {
    if (!isObj(r) || !isObj(r.bounds)) continue;
    const b = r.bounds;
    if (!num(r.id) || !num(r.pid) || typeof r.owner !== 'string' || typeof r.title !== 'string') continue;
    if (!num(b.x) || !num(b.y) || !num(b.w) || !num(b.h)) continue;
    windows.push({
      id: r.id,
      pid: r.pid,
      owner: r.owner,
      title: r.title,
      bounds: { x: b.x, y: b.y, w: b.w, h: b.h },
    });
  }
  return { windows, titlesRedacted: j.titlesRedacted === true };
}

export async function listWindows(run: Run): Promise<{ windows: Win[]; titlesRedacted: boolean }> {
  const r = await run(['windows']);
  return parseWindows(r.code === 0 ? parseJson(r.stdout) : null);
}
