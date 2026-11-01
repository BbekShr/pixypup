// One pet photo -> sprite pack. SAM cuts the pet out, Muse Image draws idle, then walk_0, then the other
// poses in parallel with idle (and walk_0 for the walk frames) as extra references, a local chroma key removes the magenta
// background and every frame is scaled to one body size on one shared canvas.
// Privacy: the photo and cutout live in memory only; the library writes just the pack.

import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import type { PetFact, Personality, SpriteManifest } from '../../contracts/types.js';
import { validateManifest } from './manifest.js';
import { editImage } from './muse-image.js';
import { MetaApiError, type MetaClient } from './meta-client.js';
import { breedFacts, meetPet } from './personality.js';
import { largest, maskAt, segment } from './sam.js';
import { isStaticSheet } from './static-sheet.js';

export { validateManifest };

export const MAGENTA = { r: 255, g: 0, b: 255 };
const TARGET_HEIGHT = 256;
const MARGIN = 2;

export const STYLE =
  'Render the exact same pet from the reference photo as a cute 3D animated-movie character, ' +
  'Pixar-style: soft volumetric fur, gentle studio lighting with soft highlights, subtle ambient occlusion, ' +
  'slightly stylised proportions (big expressive glossy eyes, rounded body), same breed, same fur colour and markings. ' +
  'Full body visible, centred, nothing cropped. Thin clean white outline around the silhouette. ' +
  'Solid flat pure magenta background (#FF00FF) filling the whole canvas, no gradient, ' +
  'no ground shadow, no reflections, no props, no text. ' +
  'Keep the same soft ears (same shape and how they hang), same face shape and same collar as the reference; ' +
  'do not change the breed or ear shape. ' +
  'Leave a clear margin of empty background on all four sides so nothing touches the canvas edge.';

// idle_0 is generated first and fed back as a second reference so every other pose copies its character design.
// A strict side profile: a 3/4 view with the head turned to the camera hides the legs, so no walk reads from it.
// Earlier wording ("side view", "passing (legs under body)") came back 3/4 with a crouched hop for the passing frames.
const SHEET =
  "A horizontal sprite sheet of exactly 4 frames of this same character walking, drawn in strict side profile facing right: " +
  "the camera is level and perpendicular to the body, we see the pet's left side, only one eye visible, " +
  'the head points right in the walking direction and does not look at the camera. All four legs clearly visible and separated. ' +
  'Frame 1: left front leg reaching forward and right hind leg reaching back. ' +
  'Frame 2: legs passing under the body, one front paw slightly lifted, body at the same height as frame 1, back level, ' +
  'not crouching, not jumping. Frame 3: right front leg forward and left hind leg back. Frame 4: legs passing under the body again. ' +
  'Same size, same body height and same head position in every frame; only the legs move. ' +
  'Evenly spaced in 4 equal columns with wide magenta gaps between frames.';

// Last resort when two 4-frame sheets failed: just the two contact poses, which Muse draws well.
const PAIR =
  'A horizontal sprite sheet of exactly 2 frames of this same character mid-stride, drawn in strict side profile facing right: ' +
  "the camera is level and perpendicular to the body, we see the pet's left side, only one eye visible, the head points right. " +
  'Frame 1: left front leg reaching far forward and right hind leg reaching far back. ' +
  'Frame 2: right front leg reaching far forward and left hind leg reaching far back. ' +
  'Same size, same body height and same head position in both frames; only the legs move. ' +
  'Two equal columns with a wide magenta gap between the frames.';

// The sheet is one request so the four frames come out as one coherent cycle (separate calls copied each other).
// idle_blink is a pure edit of the idle image: no STYLE prefix, it would invite a redraw.
export const POSES: Record<string, string> = {
  idle_0: 'Pose: standing on all four legs, side view facing right, tail relaxed.',
  walk_sheet: SHEET,
  walk_pair: PAIR,
  sit: 'Pose: sitting upright facing the viewer, front paws together.',
  sleep: 'Pose: curled up asleep lying down, eyes closed, side view.',
  bark: 'Pose: barking happily, side view facing right, mouth open, ears perked.',
  roll: 'Pose: rolling over on its back, belly up, paws in the air, playful.',
  idle_blink:
    'Edit this exact image: gently close the eyes in a blink. Change nothing else: same pose, same framing, ' +
    'same size, same position, same lighting, same magenta background.',
};

// Profile walk frames sit on their own, wider canvas (see layoutFrames); old packs' walk_0..3 are 3/4 view.
export const SIDE_FRAMES = ['side_0', 'side_1', 'side_2', 'side_3'];
const WALK_FRAMES = SIDE_FRAMES;
const SIDE = new Set(SIDE_FRAMES);
const POSE_NAMES = ['idle_0', ...WALK_FRAMES, 'sit', 'sleep', 'bark', 'roll', 'idle_blink'];
// Lying poses are sized by width, everything else by height.
const LYING = new Set(['sleep', 'roll']);
const BLINK_MIN_IOU = 0.85;

export type PipelineEvent =
  | { stage: 'cutout'; png: Buffer }
  | { stage: 'pose'; name: string; png: Buffer; index: number; total: number; fallback?: boolean }
  | { stage: 'pose-failed'; name: string; error: string }
  | { stage: 'personality'; personality: Personality }
  | { stage: 'facts'; facts: PetFact[] }
  | { stage: 'done'; manifest: SpriteManifest; dir: string };

export interface PackOptions {
  client: MetaClient;
  photo: Buffer;
  petName: string;
  species: string;
  outDir: string;
  onProgress?: (e: PipelineEvent) => void;
  /** Per-pose request timeout and retry back-off (x3 after HTTP 429); tests shrink these. */
  timing?: { timeoutMs?: number; backoffMs?: number; sparkMs?: number; sparkGraceMs?: number };
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
  /** Subject bounding box on the raw canvas (inclusive); all zero when empty. */
  box: Box;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function bboxIoU(a: Box, b: Box): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1;
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + 1;
  if (w <= 0 || h <= 0) return 0;
  const area = (r: Box) => (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
  return (w * h) / (area(a) + area(b) - w * h);
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
  return { png, bleed: bleed / (W * H), opaque: opaque / (W * H), edge: ringOpaque / ring, box: x1 < 0 ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 } };
}

export interface KeyedFrame {
  /** Keyed and trimmed PNG. */
  png: Buffer;
  /** Height of the raw canvas Muse drew on; absent for sheet slices, which have no canvas of their own. */
  rawHeight?: number;
}

/**
 * Every pose is sized from its own trimmed alpha: standing/sitting poses to idle's height (TARGET_HEIGHT),
 * lying poses (sleep, roll) to 1.1 x idle's width. Each scale is clamped to 0.6..1.6 of the raw-canvas
 * estimate so a bad drawing cannot be blown up or shrunk absurdly.
 * Frames are then centred and bottom-aligned (MARGIN px) on one shared canvas. The profile walk frames share
 * one scale (their tallest to TARGET_HEIGHT, so the sheet's proportions hold) and their own wider canvas of the
 * same height, so the foot line matches and the narrow poses keep a tight hit box.
 */
export async function layoutFrames(
  keyed: Record<string, KeyedFrame>,
  idle: string,
): Promise<{ frames: Record<string, Buffer>; width: number; height: number; footY: number }> {
  const ref = keyed[idle] as KeyedFrame;
  const refMeta = await sharp(ref.png).metadata();
  const s = TARGET_HEIGHT / refMeta.height;
  const scaled: Record<string, { buf: Buffer; w: number; h: number }> = {};
  const sides = Object.keys(keyed).filter((n) => SIDE.has(n));
  const sideMax = Math.max(1, ...(await Promise.all(sides.map(async (n) => (await sharp((keyed[n] as KeyedFrame).png).metadata()).height))));
  for (const [name, f] of Object.entries(keyed)) {
    const { width, height } = await sharp(f.png).metadata();
    let k = SIDE.has(name) ? TARGET_HEIGHT / sideMax : LYING.has(name) ? (1.1 * refMeta.width * s) / width : TARGET_HEIGHT / height;
    if (f.rawHeight && ref.rawHeight && !SIDE.has(name)) {
      const est = (s * ref.rawHeight) / f.rawHeight;
      k = Math.min(1.6 * est, Math.max(0.6 * est, k));
    }
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    scaled[name] = { buf: await sharp(f.png).resize(w, h).png().toBuffer(), w, h };
  }
  const widest = (side: boolean) => Math.max(...Object.entries(scaled).filter(([n]) => SIDE.has(n) === side).map(([, f]) => f.w));
  const width = widest(false);
  const sideWidth = sides.length ? widest(true) : width;
  const height = Math.max(...Object.values(scaled).map((f) => f.h)) + MARGIN;
  const frames: Record<string, Buffer> = {};
  for (const [name, f] of Object.entries(scaled)) {
    const w = SIDE.has(name) ? sideWidth : width;
    frames[name] = await sharp({
      create: { width: w, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: f.buf, left: Math.floor((w - f.w) / 2), top: height - MARGIN - f.h }])
      .png()
      .toBuffer();
  }
  return { frames, width, height, footY: (height - MARGIN) / height };
}

/**
 * Cut a keyed sprite sheet (RGBA) into n frames. Muse draws frames that nearly touch, so there is no
 * reliable empty gutter: each of the n-1 cuts goes at the emptiest column (fewest alpha >= 32 pixels)
 * within 18% of a frame width of k*W/n. Null unless every cut column holds <= 15% of the busiest
 * column's pixels, the n frames' alpha-bbox widths are within 35% of the median, and no frame is cropped: a real
 * silhouette ends in a thin column (nose, tail tip, paw), so a frame whose first or last column holds more than
 * 30% of its own tallest column was cut by a straight edge (Muse sometimes draws the sheet as cropped panels).
 */
export function sliceSheet(rgba: Buffer, w: number, h: number, n: number): { x0: number; x1: number }[] | null {
  const count: number[] = [];
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) if ((rgba[(y * w + x) * 4 + 3] as number) >= 32) c++;
    count.push(c);
  }
  const max = Math.max(...count);
  const half = Math.round((0.18 * w) / n);
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const mid = Math.round((k * w) / n);
    let best = mid;
    for (let x = Math.max(1, mid - half); x <= Math.min(w - 1, mid + half); x++) {
      const c = count[x] as number;
      const bc = count[best] as number;
      if (c < bc || (c === bc && Math.abs(x - mid) < Math.abs(best - mid))) best = x;
    }
    if ((count[best] as number) > 0.15 * max) return null;
    cuts.push(best);
  }
  cuts.push(w);
  const runs: { x0: number; x1: number }[] = [];
  for (let i = 0; i < n; i++) {
    let x0 = cuts[i] as number;
    let x1 = (cuts[i + 1] as number) - 1;
    while (x0 <= x1 && !count[x0]) x0++;
    while (x1 >= x0 && !count[x1]) x1--;
    if (x1 < x0) return null;
    runs.push({ x0, x1 });
  }
  for (const r of runs) {
    const tallest = Math.max(...count.slice(r.x0, r.x1 + 1));
    if ((count[r.x0] as number) > 0.3 * tallest || (count[r.x1] as number) > 0.3 * tallest) return null;
  }
  const widths = runs.map((r) => r.x1 - r.x0 + 1).sort((a, b) => a - b);
  const median = widths[Math.floor(n / 2)] as number;
  return runs.every((r) => Math.abs(r.x1 - r.x0 + 1 - median) <= 0.35 * median) ? runs : null;
}

/** Cut a keyed walk sheet into its n (default 4) frames, each trimmed to its own alpha rows. Throws on a bad sheet. */
export async function sheetFrames(k: Keyed, n = WALK_FRAMES.length): Promise<KeyedFrame[]> {
  const { data, info } = await sharp(k.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const runs = sliceSheet(data, info.width, info.height, n);
  if (!runs) throw new BadOutputError('bad sheet');
  return Promise.all(
    runs.map(async (r) => {
      const slice = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
        .extract({ left: r.x0, top: 0, width: r.x1 - r.x0 + 1, height: info.height })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let y0 = info.height;
      let y1 = -1;
      for (let i = 3; i < slice.data.length; i += 4) {
        if ((slice.data[i] as number) === 0) continue;
        const y = Math.floor(i / 4 / slice.info.width);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const png = await sharp(slice.data, { raw: { width: slice.info.width, height: info.height, channels: 4 } })
        .extract({ left: 0, top: y0, width: slice.info.width, height: y1 - y0 + 1 })
        .png()
        .toBuffer();
      return { png };
    }),
  );
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

  // "Meet your pet" runs beside the poses and never fails the pack: whatever arrived by the end goes in the manifest.
  const sparkMs = o.timing?.sparkMs ?? 30_000;
  let personality: Personality | undefined;
  let facts: PetFact[] | undefined;
  const spark = new AbortController();
  const signal = () => AbortSignal.any([spark.signal, AbortSignal.timeout(sparkMs)]);
  const meeting = (async () => {
    const p = await meetPet(o.client, cutout, o.petName, o.species, signal());
    if (!p || spark.signal.aborted) return;
    personality = p;
    emit({ stage: 'personality', personality: p });
    const f = await breedFacts(o.client, p.breed, o.species, signal());
    if (!f || spark.signal.aborted) return;
    facts = f;
    emit({ stage: 'facts', facts: f });
  })().catch(() => undefined);

  const keyed = await (async () => {
  const cutoutOnMagenta = dataUrl(await sharp(cutout).flatten({ background: MAGENTA }).png().toBuffer());

  const attempt = async <T>(prompt: string, refs: string[], finish: (img: { buffer: Buffer; mime: string }, k: Keyed) => Promise<T>) => {
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
      return await finish(img!, keyed);
    } catch (err) {
      throw Object.assign(err instanceof Error ? err : new Error(String(err)), { timedOut });
    } finally {
      clearTimeout(timer);
    }
  };
  const draw = async <T>(name: string, refs: string[], finish: (img: { buffer: Buffer; mime: string }, k: Keyed) => Promise<T>, retry = true) => {
    const prompt =
      name === 'idle_blink'
        ? POSES[name]!
        : `${STYLE} ${POSES[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '');
    try {
      return await attempt(prompt, refs, finish);
    } catch (first) {
      if (!retry) throw first;
      const wait = (first instanceof MetaApiError && first.status === 429 ? 3 : 1) * backoffMs;
      await new Promise((r) => setTimeout(r, wait));
      return await attempt(prompt, refs, finish);
    }
  };
  const poseEvent = (name: string, png: Buffer, fallback?: boolean) =>
    emit({ stage: 'pose', name, png, index: POSE_NAMES.indexOf(name), total: POSE_NAMES.length, ...(fallback ? { fallback } : {}) });

  const rawHeightOf = async (b: Buffer) => (await sharp(b).metadata()).height;
  const single = async (img: { buffer: Buffer }, k: Keyed) => ({ png: k.png, rawHeight: await rawHeightOf(img.buffer) });

  const idleDraw = await draw('idle_0', [cutoutOnMagenta], async (img, k) => ({ img, k, frame: await single(img, k) }));
  const idle = idleDraw.frame;
  poseEvent('idle_0', idle.png);
  const idleRaw = dataUrl(idleDraw.img.buffer, idleDraw.img.mime);

  const keyed: Record<string, KeyedFrame> = { idle_0: idle };
  // On failure every name in `names` falls back to the idle frame (a missing blink is harmless, a bad one is not).
  // `omit`: nothing is stored and the pose stays out of the pack (a walk made of idle frames glides); the UI still gets idle as the preview.
  const run = async (names: string[], go: () => Promise<KeyedFrame[]>, omit?: string) => {
    let failure: string | null = null;
    try {
      const out = await go();
      names.forEach((n, i) => (keyed[n] = out[i] as KeyedFrame));
    } catch (err) {
      if (!omit) names.forEach((n) => (keyed[n] = idle));
      failure = reason(err, (err as { timedOut?: boolean }).timedOut === true);
    }
    for (const n of names) {
      if (failure) emit({ stage: 'pose-failed', name: n, error: failure });
      poseEvent(n, (keyed[n] ?? idle).png, failure ? true : undefined);
    }
    if (failure && omit) emit({ stage: 'pose-failed', name: omit, error: failure });
  };
  const refs = [cutoutOnMagenta, idleRaw];
  const sheet = async (_img: unknown, k: Keyed) => {
    const frames = await sheetFrames(k);
    if (await isStaticSheet(frames)) throw new BadOutputError('static sheet');
    return frames;
  };
  // Stride, stand, stride, stand; the stand frames are idle on the walk canvas.
  const pair = async (_img: unknown, k: Keyed) => {
    const [a, b] = await sheetFrames(k, 2);
    return [a as KeyedFrame, idle, b as KeyedFrame, idle];
  };
  const walk = async () => {
    try {
      return await draw('walk_sheet', refs, sheet);
    } catch (err) {
      try {
        return await draw('walk_pair', refs, pair, false);
      } catch {
        throw err;
      }
    }
  };
  await Promise.all([
    run(WALK_FRAMES, walk, 'walk'),
    ...['sit', 'sleep', 'bark', 'roll'].map((n) => run([n], async () => [await draw(n, refs, single)])),
    run(['idle_blink'], async () => [
      await draw('idle_blink', [idleRaw], async (img, k) => {
        if (bboxIoU(k.box, idleDraw.k.box) < BLINK_MIN_IOU) throw new BadOutputError('blink moved');
        return single(img, k);
      }),
    ]),
  ]);
  return keyed;
  })().catch((err) => {
    spark.abort(); // a failed pack must not leave Spark running and billing
    throw err;
  });

  // Spark gets a short grace after the poses; whatever arrived by then goes in the manifest.
  await Promise.race([meeting, new Promise((r) => setTimeout(r, o.timing?.sparkGraceMs ?? 2000).unref())]);
  spark.abort();
  const { frames, footY } = await layoutFrames(keyed, 'idle_0');
  const pose = (frames: string[], fps: number) => ({ frames, fps, footY });
  const manifest: SpriteManifest = {
    pet: o.petName,
    species: o.species,
    poses: {
      idle: pose(['idle_0.png'], 2),
      ...(keyed['side_0'] ? { walk: pose(SIDE_FRAMES.map((f) => `${f}.png`), 8) } : {}),
      sit: pose(['sit.png'], 1),
      sleep: pose(['sleep.png'], 1),
      bark: pose(['bark.png'], 4),
      roll: pose(['roll.png'], 2),
      blink: pose(['idle_blink.png'], 1),
    },
    ...(personality ? { personality: { ...personality, ...(facts ? { facts } : {}) } } : {}),
  };
  validateManifest(manifest);
  const files: Record<string, Buffer | string> = { 'sprite-manifest.json': JSON.stringify(manifest, null, 2) };
  for (const [name, buf] of Object.entries(frames)) files[`${name}.png`] = buf;
  await writePack(o.outDir, files);
  emit({ stage: 'done', manifest, dir: o.outDir });
  return manifest;
}
