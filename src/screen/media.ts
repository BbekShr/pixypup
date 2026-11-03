import { parseJson, type Run } from './helper';

export type Media = { camera: boolean; micApps: string[] };

// An old helper has no `media` subcommand: null means unknown, never "no call".
export function parseMedia(json: unknown): Media | null {
  if (typeof json !== 'object' || json === null) return null;
  const j = json as Record<string, unknown>;
  if (typeof j.camera !== 'boolean' || !Array.isArray(j.micApps)) return null;
  const micApps = j.micApps
    .filter((s): s is string => typeof s === 'string' && /^[\w.-]{1,120}$/.test(s))
    .slice(0, 50);
  return { camera: j.camera, micApps };
}

export async function getMedia(run: Run): Promise<Media | null> {
  const r = await run(['media']);
  return r.code === 0 ? parseMedia(parseJson(r.stdout)) : null;
}
