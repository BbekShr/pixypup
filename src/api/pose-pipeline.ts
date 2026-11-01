// One pet photo -> sprite pack. SAM cuts the pet out, Muse Image draws idle first, then the other
// poses in parallel with idle as a second reference, a local chroma key removes the magenta
// background and every frame is scaled to one body size on one shared canvas.
// Privacy: the photo and cutout live in memory only; the library writes just the pack.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { SpriteManifest } from '../../contracts/types.js';
import { editImage } from './muse-image.js';
import type { MetaClient } from './meta-client.js';
import { largest, maskAt, segment } from './sam.js';

export const MAGENTA = { r: 255, g: 0, b: 255 };
const TARGET_HEIGHT = 256;
const MARGIN = 2;
const POSE_TIMEOUT_MS = 60_000;

export const STYLE =
  'Redraw the exact same pet from the reference photo as a cute chibi sticker character: ' +
  'same breed, same fur colours and markings, same ear shape, big friendly eyes, soft cel shading, ' +
  'thick clean white sticker outline. Full body visible, centred, nothing cropped. ' +
  'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
  'no ground shadow, no props, no text.';

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
  | { stage: 'pose'; name: string; png: Buffer; index: number; total: number }
  | { stage: 'pose-failed'; name: string; error: string }
  | { stage: 'done'; manifest: SpriteManifest; dir: string };

export interface PackOptions {
  client: MetaClient;
  photo: Buffer;
  petName: string;
  species: 'dog' | 'cat';
  outDir: string;
  onProgress?: (e: PipelineEvent) => void;
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
export async function readPhoto(path: string): Promise<Buffer> {
  if (!/\.heic$/i.test(path)) return readFile(path);
  const dir = await mkdtemp(join(tmpdir(), 'pixy-'));
  try {
    const out = join(dir, 'photo.png');
    await promisify(execFile)('sips', ['-s', 'format', 'png', path, '--out', out]);
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

/** Key out the flat magenta background locally (free, instant), then trim. */
export async function chromaKey(img: Buffer): Promise<{ png: Buffer; bleed: number }> {
  const { data, info } = await sharp(img).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let bleed = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const dist = Math.hypot(r - MAGENTA.r, g - MAGENTA.g, b - MAGENTA.b);
    if (dist < 90) data[i + 3] = 0;
    else if (dist < 160) {
      // Soft edge; also counts magenta fringe that survived, a sign the key bled.
      data[i + 3] = Math.round(((dist - 90) / 70) * 255);
      if (r > 180 && b > 180 && g < 120) bleed++;
    }
  }
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim()
    .png()
    .toBuffer();
  return { png, bleed: bleed / (info.width * info.height) };
}

export interface KeyedFrame {
  /** Keyed and trimmed PNG. */
  png: Buffer;
  /** Width of the raw canvas Muse drew on, before trimming. */
  rawWidth: number;
}

/**
 * One scale for every pose (TARGET_HEIGHT / idle's trimmed height) keeps sit/sleep/roll at their
 * natural proportions; a pose drawn on a different canvas size is first rescaled to idle's canvas.
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
    const k = (s * ref.rawWidth) / f.rawWidth;
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
    if (!Array.isArray(d.frames) || d.frames.some((f) => typeof f !== 'string')) bad(`pose ${name} frames`);
    if (typeof d.fps !== 'number') bad(`pose ${name} fps`);
    if (typeof d.footY !== 'number') bad(`pose ${name} footY`);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`Timed out after ${ms / 1000}s.`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Publish `files` as outDir without ever leaving a half-written or missing pack. */
async function writePack(outDir: string, files: Record<string, Buffer | string>): Promise<void> {
  await mkdir(join(outDir, '..'), { recursive: true });
  const tmp = await mkdtemp(`${outDir}.tmp-`);
  const old = `${outDir}.old`;
  try {
    for (const [name, data] of Object.entries(files)) await writeFile(join(tmp, name), data);
    await rm(old, { recursive: true, force: true });
    const hadOld = await rename(outDir, old).then(() => true, () => false);
    await rename(tmp, outDir);
    if (hadOld) await rm(old, { recursive: true, force: true });
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
}

export async function generateSpritePack(o: PackOptions): Promise<SpriteManifest> {
  const emit = o.onProgress ?? (() => undefined);
  const photo = await normalizePhoto(o.photo);
  const cutout = await samCutout(o.client, photo, o.species);
  if (!cutout) throw new NoPetFoundError(o.species);
  emit({ stage: 'cutout', png: cutout });

  const cutoutOnMagenta = dataUrl(await sharp(cutout).flatten({ background: MAGENTA }).png().toBuffer());

  const draw = async (name: string, refs: string[]) => {
    const prompt = `${STYLE} ${POSES[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '');
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [img] = await withTimeout(editImage(o.client, prompt, refs), POSE_TIMEOUT_MS);
        const rawWidth = (await sharp(img!.buffer).metadata()).width;
        return { img: img!, keyed: { png: (await chromaKey(img!.buffer)).png, rawWidth } };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  };
  const poseEvent = (name: string, png: Buffer) =>
    emit({ stage: 'pose', name, png, index: POSE_NAMES.indexOf(name), total: POSE_NAMES.length });

  const idle = await draw('idle_0', [cutoutOnMagenta]);
  poseEvent('idle_0', idle.keyed.png);
  const refs = [cutoutOnMagenta, dataUrl(idle.img.buffer, idle.img.mime)];

  const keyed: Record<string, KeyedFrame> = { idle_0: idle.keyed };
  await Promise.all(
    POSE_NAMES.slice(1).map(async (name) => {
      try {
        const r = await draw(name, refs);
        keyed[name] = r.keyed;
        poseEvent(name, r.keyed.png);
      } catch (err) {
        keyed[name] = idle.keyed;
        emit({ stage: 'pose-failed', name, error: (err as Error).message });
      }
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
