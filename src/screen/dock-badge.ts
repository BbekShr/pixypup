import { parseJson, type Run } from './helper';

export function parseBadges(json: unknown): Record<string, string> | 'permission' | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  if (j.error === 'permission') return 'permission';
  if (typeof j.badges !== 'object' || j.badges === null || Array.isArray(j.badges)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(j.badges)) if (typeof v === 'string') out[k] = v;
  return out;
}

const count = (label: string) => (/^\d+/.test(label) ? parseInt(label, 10) : NaN); // "99+" -> 99

// A badge that is new, or whose count went up. Labels are untrusted app text.
export function badgeBump(
  prev: Record<string, string>,
  next: Record<string, string>,
): { app: string; label: string } | null {
  for (const [app, label] of Object.entries(next)) {
    if (!label || app.toLowerCase() === 'pixypup') continue;
    const old = prev[app];
    if (old === undefined || count(label) > count(old)) return { app, label };
  }
  return null;
}

export async function getBadges(run: Run): Promise<Record<string, string> | null> {
  const r = await run(['badges']);
  const b = parseBadges(r.code === 0 ? parseJson(r.stdout) : null);
  return b && b !== 'permission' ? b : null;
}
