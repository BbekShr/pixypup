import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { MetaApiError } from '../api/meta-client';
import { NoPetFoundError, readPhoto } from '../api/pose-pipeline';
import { SPECIES_RE } from '../api/profile-defaults';

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PHOTO_EXTS = ['jpg', 'jpeg', 'png', 'heic', 'webp'];
export type PhotoCode = 'missing' | 'type' | 'size';
export type ErrorCode = 'bad-key' | 'no-pet-found' | 'network' | 'generation-failed';

/** Names with no Latin letters or digits get a short stable hash so two emoji pets never share a folder. */
export const slugify = (name: string): string =>
  name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') ||
  `pet-${createHash('sha1').update(name.trim().normalize()).digest('hex').slice(0, 4)}`;

/** Never silently overwrite another pet: only the pet being replaced (`current`) may reuse its own folder. */
export async function pickSlug(base: string, current: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  let slug = base;
  for (let n = 2; slug !== current && (await exists(slug)); n++) slug = `${base}-${n}`;
  return slug;
}

/** The path comes from the renderer (drag-drop), so main re-checks everything before it reads the file. */
export async function checkPhoto(path: unknown): Promise<{ ok: true; path: string } | { ok: false; code: PhotoCode }> {
  if (typeof path !== 'string' || !isAbsolute(path) || path.length > 4096) return { ok: false, code: 'missing' };
  if (!PHOTO_EXTS.includes(path.split('.').pop()!.toLowerCase())) return { ok: false, code: 'type' };
  try {
    const s = await stat(path);
    if (!s.isFile()) return { ok: false, code: 'missing' };
    if (s.size > MAX_PHOTO_BYTES) return { ok: false, code: 'size' };
  } catch {
    return { ok: false, code: 'missing' };
  }
  return { ok: true, path };
}

/** One read at pick time: the pipeline later gets this buffer, never the path again. */
export async function loadPhoto(path: unknown): Promise<{ ok: true; buf: Buffer } | { ok: false; code: PhotoCode | 'unreadable' }> {
  const c = await checkPhoto(path);
  if (!c.ok) return c;
  try {
    const buf = await readPhoto(c.path);
    // HEIC comes back as a (larger) PNG, so the cap is judged on the file only when it is not converted.
    if (buf.length > (/\.heic$/i.test(c.path) ? MAX_PHOTO_BYTES * 4 : MAX_PHOTO_BYTES)) return { ok: false, code: 'size' };
    return { ok: true, buf };
  } catch {
    return { ok: false, code: 'unreadable' };
  }
}

export function checkCreateArgs(a: unknown): { name: string; species: string } | null {
  if (typeof a !== 'object' || a === null) return null;
  const { name, species } = a as Record<string, unknown>;
  if (typeof name !== 'string' || typeof species !== 'string') return null;
  const n = name.trim();
  const sp = species.trim();
  const control = [...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  return n.length >= 1 && n.length <= 24 && !control && SPECIES_RE.test(sp) ? { name: n, species: sp } : null;
}

export const checkKey = (k: unknown): k is string => typeof k === 'string' && /^\S{8,512}$/.test(k);

/** Only these codes reach the UI; raw error messages (which can echo API bodies) never do. */
export function errorCode(err: unknown): ErrorCode {
  if (err instanceof MetaApiError && (err.status === 401 || err.status === 403)) return 'bad-key';
  if (err instanceof NoPetFoundError) return 'no-pet-found';
  // fetch rejects with TypeError('fetch failed', {cause}) when offline; any other TypeError is our own bug.
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError' || (err instanceof TypeError && (err.cause != null || /fetch failed/i.test(err.message))))) return 'network';
  return 'generation-failed';
}

/** An open onboarding window is reused unless it was opened for a different mode and no create run is using it (a run keeps its own mode). */
export const reuseOnboardingWindow = (shown: { fromMenu: boolean; add: boolean }, want: { fromMenu: boolean; add: boolean }, runInFlight: boolean): boolean =>
  runInFlight || (shown.fromMenu === want.fromMenu && shown.add === want.add);
