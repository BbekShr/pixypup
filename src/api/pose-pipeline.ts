// One pet photo -> sprite pack. SAM cuts the pet out, Muse Image draws idle first, then the other
// poses in parallel with idle as a second reference, a local chroma key removes the magenta
// background and every frame is scaled to one body size on one shared canvas.
// Privacy: the photo and cutout live in memory only; the library writes just the pack.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { SpriteManifest } from '../../contracts/types.js';
import { editImage } from './muse-image.js';
import { MetaApiError, type MetaClient } from './meta-client.js';
import { largest, maskAt, segment } from './sam.js';

export const MAGENTA = { r: 255, g: 0, b: 255 };
const TARGET_HEIGHT = 256;
const MARGIN = 2;

export const STYLE =
  'Redraw the exact same pet from the reference photo as a cute chibi sticker character: ' +
  'same breed, same fur colours and markings, same ear shape, big friendly eyes, soft cel shading, ' +
  'thick clean white sticker outline. Full body visible, centred, nothing cropped. ' +
  'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
  'no ground shadow, no props, no text. ' +
  'Keep the same soft ears (same shape and how they hang), same face shape and same collar as the reference; ' +
  'do not change the breed or ear shape. ' +
  'Leave a clear margin of empty background on all four sides so nothing touches the canvas edge.';

// idle_0 is generated first and then fed back as a second reference so every other pose
// copies its character design.
export const POSES: Record<string, string> = {
  idle_0: 'Pose: standing on all four legs, side view facing right, tail relaxed.',
  walk_0: 'Pose: mid-walk, side view facing right, front-left and back-right legs forward.',
  walk_1: 'Pose: mid-walk, side view facing right, front-right and back-left legs forward.',
  sit: 'Pose: sitting upright facing the viewer, front paws together.',
  sleep: 'Pose: curled up asleep lying down, eyes closed, side view.',
  bark: 'Pose: barking happily, side view facing right, mouth open, ears perked.',
  roll: 'Pose: rolling over on its back, belly up, paws in the air, playful.',
};

const POSE_NAMES = Object.keys(POSES);

export type PipelineEvent =
  | { stage: 'cutout'; png: Buffer }
  | { stage: 'pose'; name: string; png: Buffer; index: number; total: number; fallback?: boolean }
  | { stage: 'pose-failed'; name: string; error: string }
  | { stage: 'done'; manifest: SpriteManifest; dir: string };

export interface PackOptions {
  client: MetaClient;
  photo: Buffer;
  petName: string;
  species: 'dog' | 'cat';
  outDir: string;
  onProgress?: (e: PipelineEvent) => void;
  /** Per-pose request timeout and retry back-off (x3 after HTTP 429); tests shrink these. */
  timing?: { timeoutMs?: number; backoffMs?: number };
}

export class NoPetFoundError extends Error {
  constructor(species: string) {
    super(`No ${species} found in the photo.`);
    this.name = 'NoPetFoundError';
  }
}

export function dataUrl(buf: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/** sharp's prebuilt libvips has no HEVC decoder, so iPhone HEIC goes through macOS `sips` first. */
export async function readPhoto(input: string): Promise<Buffer> {
  const path = resolve(input);
  if (!/\.heic$/i.test(path)) return readFile(path);
  const dir = await mkdtemp(join(tmpdir(), 'pixy-'));
  try {
    const out = join(dir, 'photo.png');
    await promisify(execFile)('sips', ['-s', 'format', 'png', path, '--out', out], { timeout: 30_000 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Rotate by EXIF, cap at 1536px, PNG: HEIC/JPEG in, small upload out. */
export function normalizePhoto(photo: Buffer): Promise<Buffer> {
  return sharp(photo).rotate().resize(1536, 1536, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
}

/** SAM-segment the pet, return a tight transparent PNG cutout. */
export async function samCutout(client: MetaClient, png: Buffer, prompt: string): Promise<Buffer | null> {
  const matches = await segment(client, prompt, dataUrl(png));
  const m = largest(matches);
  if (!m) return null;
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = Math.max(0, m.box.left);
  const top = Math.max(0, m.box.top);
  const w = Math.min(info.width, m.box.right) - left;
  const h = Math.min(info.height, m.box.bottom) - top;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((top + y) * info.width + (left + x)) * 4;
      const dst = (y * w + x) * 4;
      data.copy(out, dst, src, src + 4);
      out[dst + 3] = maskAt(m, x + left - m.box.left, y + top - m.box.top) ? 255 : 0;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** 0 = not magenta, 1 = pure background magenta; in between = anti-aliased edge (magenta mixed with the subject). */
function magentaness(r: number, g: number, b: number): number {
  if (Math.abs(r - b) > 60) return 0;
  return Math.min(1, Math.max(0, ((Math.min(r, b) - g) / 255 - 0.25) / 0.55));
}

export interface Keyed {
  png: Buffer;
  /** Fraction of pixels still magenta-ish after keying and despill. */
  bleed: number;
  /** Fraction of the canvas that is subject. */
  opaque: number;
  /** Fraction of the canvas border that is subject: the model drew past the edge. */
  edge: number;
}

/**
 * Key out the flat magenta background locally (free, instant), pull the magenta out of
 * anti-aliased edge pixels, then trim. Hue-based so pink subjects survive.
 */
export async function chromaKey(img: Buffer): Promise<Keyed> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info;
  let bleed = 0;
  let opaque = 0;
  let ring = 0;
  let ringOpaque = 0;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let i = 0; i < data.length; i += 4) {
    const mag = magentaness(data[i] as number, data[i + 1] as number, data[i + 2] as number);
    const px = i / 4;
    const x = px % W;
    const y = (px - x) / W;
    const onRing = x === 0 || y === 0 || x === W - 1 || y === H - 1;
    if (mag >= 1) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
    } else {
      if (mag > 0) {
        // colour = mag * magenta + (1 - mag) * subject, solve for the subject colour.
        const k = 1 - mag;
        data[i] = Math.min(255, Math.max(0, Math.round(((data[i] as number) - mag * MAGENTA.r) / k)));
        data[i + 1] = Math.min(255, Math.max(0, Math.round((data[i + 1] as number) / k)));
        data[i + 2] = Math.min(255, Math.max(0, Math.round(((data[i + 2] as number) - mag * MAGENTA.b) / k)));
        data[i + 3] = Math.round(k * 255);
      }
      if (magentaness(data[i] as number, data[i + 1] as number, data[i + 2] as number) > 0.1) bleed++;
      if ((data[i + 3] as number) > 0) {
        opaque++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
    if (onRing) {
      ring++;
      if ((data[i + 3] as number) > 128) ringOpaque++;
    }
  }
  // Own bbox instead of sharp's trim(), which also drops faint anti-aliased edge pixels.
  const crop = x1 < 0 ? { left: 0, top: 0, width: W, height: H } : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
  const png = await sharp(data, { raw: { width: W, height: H, channels: 4 } }).extract(crop).png().toBuffer();
  return { png, bleed: bleed / (W * H), opaque: opaque / (W * H), edge: ringOpaque / ring };
}

export interface KeyedFrame {
  /** Keyed and trimmed PNG. */
  png: Buffer;
  /** Height of the raw canvas Muse drew on, before trimming. */
  rawHeight: number;
}

/**
 * One scale for every pose (TARGET_HEIGHT / idle's trimmed height) keeps sit/sleep/roll at their
 * natural proportions; a pose drawn on a different canvas size is first rescaled by the raw height ratio
 * (heights are what we normalise).
 * Frames are then centred and bottom-aligned (MARGIN px) on one shared canvas.
 */
export async function layoutFrames(
  keyed: Record<string, KeyedFrame>,
  idle: string,
): Promise<{ frames: Record<string, Buffer>; width: number; height: number; footY: number }> {
  const ref = keyed[idle] as KeyedFrame;
  const s = TARGET_HEIGHT / (await sharp(ref.png).metadata()).height;
  const scaled: Record<string, { buf: Buffer; w: number; h: number }> = {};
  for (const [name, f] of Object.entries(keyed)) {
    const { width, height } = await sharp(f.png).metadata();
    const k = (s * ref.rawHeight) / f.rawHeight;
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    scaled[name] = { buf: await sharp(f.png).resize(w, h).png().toBuffer(), w, h };
  }
  const width = Math.max(...Object.values(scaled).map((f) => f.w));
  const height = Math.max(...Object.values(scaled).map((f) => f.h)) + MARGIN;
  const frames: Record<string, Buffer> = {};
  for (const [name, f] of Object.entries(scaled)) {
    frames[name] = await sharp({
      create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: f.buf, left: Math.floor((width - f.w) / 2), top: height - MARGIN - f.h }])
      .png()
      .toBuffer();
  }
  return { frames, width, height, footY: (height - MARGIN) / height };
}

export function validateManifest(m: unknown): asserts m is SpriteManifest {
  const bad = (why: string): never => {
    throw new Error(`Invalid sprite manifest: ${why}`);
  };
  if (typeof m !== 'object' || m === null) return bad('not an object');
  const o = m as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['pet', 'species', 'poses'].includes(k))) bad('unknown key');
  if (typeof o.pet !== 'string') bad('pet');
  if (o.species !== 'dog' && o.species !== 'cat') bad('species');
  if (typeof o.poses !== 'object' || o.poses === null) return bad('poses');
  for (const [name, p] of Object.entries(o.poses)) {
    const d = p as Record<string, unknown> | null;
    if (typeof d !== 'object' || d === null) return bad(`pose ${name}`);
    if (Object.keys(d).some((k) => !['frames', 'fps', 'footY'].includes(k))) bad(`pose ${name} unknown key`);
    if (!Array.isArray(d.frames) || d.frames.length === 0 || d.frames.some((f) => typeof f !== 'string')) bad(`pose ${name} frames`);
    if (typeof d.fps !== 'number') bad(`pose ${name} fps`);
    if (typeof d.footY !== 'number') bad(`pose ${name} footY`);
  }
}

/** Publish `files` as outDir without ever leaving a half-written or missing pack. `mv` is injectable for tests. */
export async function writePack(
  outDir: string,
  files: Record<string, Buffer | string>,
  mv: typeof rename = rename,
): Promise<void> {
  const dir = resolve(outDir);
  await mkdir(join(dir, '..'), { recursive: true });
  const tmp = await mkdtemp(`${dir}.tmp-`);
  const old = `${dir}.old`;
  try {
    for (const [name, data] of Object.entries(files)) await writeFile(join(tmp, name), data);
    await rm(old, { recursive: true, force: true });
    let hadOld = false;
    try {
      await mv(dir, old);
      hadOld = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    try {
      await mv(tmp, dir);
    } catch (err) {
      if (hadOld) await mv(old, dir).catch(() => undefined);
      throw err;
    }
    if (hadOld) await rm(old, { recursive: true, force: true }).catch(() => undefined);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

class BadOutputError extends Error {}

/** Short, body-free reason for the UI; the API response body never leaves this file. */
function reason(err: unknown, timedOut: boolean): string {
  if (timedOut) return 'timeout';
  if (err instanceof MetaApiError) return `generation-failed (HTTP ${err.status})`;
  if (err instanceof BadOutputError) return 'bad-output';
  return 'generation-failed';
}

export async function generateSpritePack(o: PackOptions): Promise<SpriteManifest> {
  // A UI callback must never be able to change the result.
  const emit = (e: PipelineEvent) => {
    try {
      o.onProgress?.(e);
    } catch {
      /* ignore */
    }
  };
  const timeoutMs = o.timing?.timeoutMs ?? 60_000;
  const backoffMs = o.timing?.backoffMs ?? 1000;
  const photo = await normalizePhoto(o.photo);
  const cutout = await samCutout(o.client, photo, o.species);
  if (!cutout) throw new NoPetFoundError(o.species);
  emit({ stage: 'cutout', png: cutout });

  const cutoutOnMagenta = dataUrl(await sharp(cutout).flatten({ background: MAGENTA }).png().toBuffer());

  const attempt = async (prompt: string, refs: string[]) => {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    try {
      const [img] = await editImage(o.client, prompt, refs, 1, { signal: ctl.signal });
      const keyed = await chromaKey(img!.buffer);
      if (keyed.opaque < 0.02 || keyed.opaque > 0.9 || keyed.edge > 0.01) throw new BadOutputError('degenerate pose');
      return { img: img!, keyed: { png: keyed.png, rawHeight: (await sharp(img!.buffer).metadata()).height } };
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { timedOut });
    } finally {
      clearTimeout(timer);
    }
  };
  const draw = async (name: string, refs: string[]) => {
    const prompt = `${STYLE} ${POSES[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '');
    try {
      return await attempt(prompt, refs);
    } catch (first) {
      const wait = (first instanceof MetaApiError && first.status === 429 ? 3 : 1) * backoffMs;
      await new Promise((r) => setTimeout(r, wait));
      return await attempt(prompt, refs);
    }
  };
  const poseEvent = (name: string, png: Buffer, fallback?: boolean) =>
    emit({ stage: 'pose', name, png, index: POSE_NAMES.indexOf(name), total: POSE_NAMES.length, ...(fallback ? { fallback } : {}) });

  const idle = await draw('idle_0', [cutoutOnMagenta]);
  poseEvent('idle_0', idle.keyed.png);
  const refs = [cutoutOnMagenta, dataUrl(idle.img.buffer, idle.img.mime)];

  const keyed: Record<string, KeyedFrame> = { idle_0: idle.keyed };
  await Promise.all(
    POSE_NAMES.slice(1).map(async (name) => {
      let failure: string | null = null;
      try {
        keyed[name] = (await draw(name, refs)).keyed;
      } catch (err) {
        keyed[name] = idle.keyed;
        failure = reason(err, (err as { timedOut?: boolean }).timedOut === true);
      }
      if (failure) emit({ stage: 'pose-failed', name, error: failure });
      poseEvent(name, (keyed[name] as KeyedFrame).png, failure ? true : undefined);
    }),
  );

  const { frames, footY } = await layoutFrames(keyed, 'idle_0');
  const pose = (frames: string[], fps: number) => ({ frames, fps, footY });
  const manifest: SpriteManifest = {
    pet: o.petName,
    species: o.species,
    poses: {
      idle: pose(['idle_0.png'], 2),
      walk: pose(['walk_0.png', 'walk_1.png'], 6),
      sit: pose(['sit.png'], 1),
      sleep: pose(['sleep.png'], 1),
      bark: pose(['bark.png'], 4),
      roll: pose(['roll.png'], 2),
    },
  };
  validateManifest(manifest);
  const files: Record<string, Buffer | string> = { 'sprite-manifest.json': JSON.stringify(manifest, null, 2) };
  for (const [name, buf] of Object.entries(frames)) files[`${name}.png`] = buf;
  await writePack(o.outDir, files);
  emit({ stage: 'done', manifest, dir: o.outDir });
  return manifest;
}
