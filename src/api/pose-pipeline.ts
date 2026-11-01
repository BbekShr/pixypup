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
import type { MotionProfile, PetFact, Personality, SpriteManifest } from '../../contracts/types.js';
import { validateManifest } from './manifest.js';
import { editImage } from './muse-image.js';
import { MetaApiError, type MetaClient } from './meta-client.js';
import { motionProfile } from './motion-profile.js';
import { breedFacts, meetPet } from './personality.js';
import { posesFor, styleFor } from './pose-prompts.js';
import { defaultProfile } from './profile-defaults.js';
import { largest, maskAt, segment } from './sam.js';
import { sliceComponents } from './slice-components.js';
import { isStaticSheet } from './static-sheet.js';

export { validateManifest };

export const MAGENTA = { r: 255, g: 0, b: 255 };
const TARGET_HEIGHT = 256;
const MARGIN = 2;

export const STYLE = styleFor(defaultProfile('dog'));
/** The dog prompts, for scripts and tests; a pack draws from its own profile (posesFor). */
export const POSES = posesFor(defaultProfile('dog'));

// Profile walk frames sit on their own, wider canvas (see layoutFrames); old packs' walk_0..3 are 3/4 view.
// 8 on the full 2x4 phase sheet (side_0 is the right-front contact, then down, pass, up, then the left side), 4 on the fallback.
export const SIDE_FRAMES = Array.from({ length: 8 }, (_, i) => `side_${i}`);
const WALK_ROWS = 2;
// Front, front 3/4, side, back 3/4, back: the identity turnaround, sliced from one sheet.
export const TURN_FRAMES = ['turn_front', 'turn_front34', 'turn_side', 'turn_back34', 'turn_back'];
// Side and turn frames each share one scale and one wider canvas; every other pose is sized on its own.
const group = (n: string) => (n.startsWith('side_') ? 's' : n.startsWith('turn_') ? 't' : 'm');
const POSE_NAMES = ['idle_0', ...SIDE_FRAMES, ...TURN_FRAMES, 'sit', 'sleep', 'bark', 'roll', 'idle_blink'];
// Lying poses are sized by width, everything else by height.
const LYING = new Set(['sleep', 'roll']);
const BLINK_MIN_IOU = 0.85;

export type PipelineEvent =
  | { stage: 'cutout'; png: Buffer }
  | { stage: 'profile'; profile: MotionProfile }
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
  timing?: { timeoutMs?: number; backoffMs?: number; sparkMs?: number; sparkGraceMs?: number; profileMs?: number };
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
export async function samCutout(client: MetaClient, png: Buffer, prompt: string, signal?: AbortSignal): Promise<Buffer | null> {
  const matches = await segment(client, prompt, dataUrl(png), signal);
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
  const maxH: Record<string, number> = {};
  for (const [n, f] of Object.entries(keyed)) {
    const g = group(n);
    if (g !== 'm') maxH[g] = Math.max(maxH[g] ?? 1, (await sharp(f.png).metadata()).height);
  }
  for (const [name, f] of Object.entries(keyed)) {
    const { width, height } = await sharp(f.png).metadata();
    const g = group(name);
    let k = g !== 'm' ? TARGET_HEIGHT / (maxH[g] as number) : LYING.has(name) ? (1.1 * refMeta.width * s) / width : TARGET_HEIGHT / height;
    if (f.rawHeight && ref.rawHeight && g === 'm') {
      const est = (s * ref.rawHeight) / f.rawHeight;
      k = Math.min(1.6 * est, Math.max(0.6 * est, k));
    }
    const w = Math.max(1, Math.round(width * k));
    const h = Math.max(1, Math.round(height * k));
    scaled[name] = { buf: await sharp(f.png).resize(w, h).png().toBuffer(), w, h };
  }
  const widest = (g: string) => Math.max(...Object.entries(scaled).filter(([n]) => group(n) === g).map(([, f]) => f.w));
  const widths: Record<string, number> = { m: widest('m') };
  for (const g of Object.keys(maxH)) widths[g] = widest(g);
  const width = widths['m'] as number;
  const height = Math.max(...Object.values(scaled).map((f) => f.h)) + MARGIN;
  const frames: Record<string, Buffer> = {};
  for (const [name, f] of Object.entries(scaled)) {
    const w = widths[group(name)] as number;
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

/** Cut a keyed sheet into n frames in reading order (`rows` > 1: a grid). By connected components, else by columns when bodies are merged. Throws on a bad sheet. */
export async function sheetFrames(k: Keyed, n = 4, rows = 1): Promise<KeyedFrame[]> {
  const { data, info } = await sharp(k.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = (c: { data: Buffer; width: number; height: number }) =>
    sharp(c.data, { raw: { width: c.width, height: c.height, channels: 4 } }).png().toBuffer();
  const crops = sliceComponents(data, info.width, info.height, n, rows);
  if (crops) return Promise.all(crops.map(async (c) => ({ png: await raw(c) })));
  const bands = rows === 1 ? [data] : rowBands(data, info.width, info.height, rows);
  if (!bands) throw new BadOutputError('bad sheet');
  const cols = n / rows;
  return (await Promise.all(bands.map((band) => cutColumns(band, info.width, band.length / 4 / info.width, cols)))).flat();
}

/** Split a grid sheet into row bands at the emptiest pixel row near each row boundary; null when no row is empty enough. */
function rowBands(rgba: Buffer, w: number, h: number, rows: number): Buffer[] | null {
  const count: number[] = [];
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if ((rgba[(y * w + x) * 4 + 3] as number) >= 32) c++;
    count.push(c);
  }
  const max = Math.max(...count);
  const cuts = [0];
  for (let r = 1; r < rows; r++) {
    const mid = Math.round((r * h) / rows);
    const span = Math.round((0.15 * h) / rows);
    let best = mid;
    for (let y = mid - span; y <= mid + span; y++) if ((count[y] as number) < (count[best] as number)) best = y;
    if ((count[best] as number) > 0.05 * max) return null;
    cuts.push(best);
  }
  cuts.push(h);
  return cuts.slice(0, -1).map((y0, i) => rgba.subarray(y0 * w * 4, (cuts[i + 1] as number) * w * 4));
}

/** The column cut: each frame trimmed to its own alpha rows. */
async function cutColumns(data: Buffer, width: number, height: number, n: number): Promise<KeyedFrame[]> {
  const runs = sliceSheet(data, width, height, n);
  if (!runs) throw new BadOutputError('bad sheet');
  return Promise.all(
    runs.map(async (r) => {
      const slice = await sharp(data, { raw: { width, height, channels: 4 } })
        .extract({ left: r.x0, top: 0, width: r.x1 - r.x0 + 1, height })
        .raw()
        .toBuffer({ resolveWithObject: true });
      let y0 = height;
      let y1 = -1;
      for (let i = 3; i < slice.data.length; i += 4) {
        if ((slice.data[i] as number) === 0) continue;
        const y = Math.floor(i / 4 / slice.info.width);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      const png = await sharp(slice.data, { raw: { width: slice.info.width, height, channels: 4 } })
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
  const cutout = await samCutout(o.client, photo, o.species, AbortSignal.timeout(timeoutMs));
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

  // Poses are drawn from the profile, so it is awaited (12 s at most); Spark failing or running late means the species default.
  const profileMs = o.timing?.profileMs ?? 12_000;
  const profile = await new Promise<MotionProfile | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), profileMs);
    motionProfile(o.client, cutout, o.petName, o.species, AbortSignal.any([spark.signal, AbortSignal.timeout(profileMs)])).then(
      (p) => (clearTimeout(timer), resolve(p)),
      () => (clearTimeout(timer), resolve(null)),
    );
  }).then((p) => p ?? defaultProfile(o.species));
  emit({ stage: 'profile', profile });
  const style = styleFor(profile);
  const poses = posesFor(profile);

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
        ? poses[name]!
        : `${style} ${poses[name]}` + (refs.length > 1 ? ' Match the character design of the second image exactly.' : '') + (refs.length > 2 ? ' The third image shows the same character from every angle; keep it consistent with those views.' : '');
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
      names = names.slice(0, out.length); // a fallback walk has fewer frames than the full sheet
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
  // One sheet of five views; later poses see it as an extra reference so every angle agrees. Failure just skips it.
  let turnRaw: string | undefined;
  await run(
    TURN_FRAMES,
    async () => {
      const t = await draw('turn_sheet', [cutoutOnMagenta, idleRaw], async (img, k) => ({ frames: await sheetFrames(k, TURN_FRAMES.length), raw: dataUrl(img.buffer, img.mime) }));
      turnRaw = t.raw;
      return t.frames;
    },
    'turn',
  );
  const refs = [cutoutOnMagenta, idleRaw, ...(turnRaw ? [turnRaw] : [])];
  const sheet = (n: number, rows: number) => async (_img: unknown, k: Keyed) => {
    const frames = await sheetFrames(k, n, rows);
    if (await isStaticSheet(frames)) throw new BadOutputError('static sheet');
    return frames;
  };
  // Stride, stand, stride, stand; the stand frames are idle on the walk canvas.
  const pair = async (_img: unknown, k: Keyed) => {
    const [a, b] = await sheetFrames(k, 2);
    return [a as KeyedFrame, idle, b as KeyedFrame, idle];
  };
  // Walk: the 8-phase grid (2 tries), then the old 4-frame sheet (1 try), then two contact poses (1 try), then no walk.
  // Other cycle kinds: their 4-frame sheet (2 tries), then the pair. Worst case 4 walk calls.
  const walk = async () => {
    const tries: (() => Promise<KeyedFrame[]>)[] =
      profile.cycle.kind === 'walk'
        ? [() => draw('walk_sheet8', refs, sheet(8, WALK_ROWS)), () => draw('walk_sheet', refs, sheet(4, 1), false)]
        : [() => draw('walk_sheet', refs, sheet(4, 1))];
    tries.push(() => draw('walk_pair', refs, pair, false));
    let first: unknown;
    for (const t of tries) {
      try {
        return await t();
      } catch (err) {
        first ??= err;
      }
    }
    throw first;
  };
  await Promise.all([
    run(SIDE_FRAMES, walk, 'walk'),
    ...['sit', 'sleep', 'bark', 'roll'].map((n) => run([n], async () => [await draw(n, refs, single)])),
    run(['idle_blink'], async () => [
      await draw('idle_blink', [idleRaw, ...(turnRaw ? [turnRaw] : [])], async (img, k) => {
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
    profile,
    poses: {
      idle: pose(['idle_0.png'], 2),
      // side_0 is a contact pose (a front leg fully forward); on the 8-frame sheet it is the right-front contact, then down, pass, up, then the left side.
      ...(keyed['side_0'] ? { walk: pose(SIDE_FRAMES.filter((f) => keyed[f]).map((f) => `${f}.png`), 8) } : {}),
      ...(keyed['turn_front'] ? { turn: pose(TURN_FRAMES.map((f) => `${f}.png`), 1) } : {}),
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
