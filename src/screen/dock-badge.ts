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

// Only short labels ("3", "•", "99+") are counts; longer strings are arbitrary app text.
export function slackBadge(badges: Record<string, string>): string | null {
  for (const [name, label] of Object.entries(badges)) {
    if (name.toLowerCase() === 'slack' && label.length > 0 && label.length <= 4) return label;
  }
  return null;
}

export async function getSlackBadge(run: Run): Promise<string | null> {
  const r = await run(['badges']);
  const b = parseBadges(r.code === 0 ? parseJson(r.stdout) : null);
  return b && b !== 'permission' ? slackBadge(b) : null;
}
