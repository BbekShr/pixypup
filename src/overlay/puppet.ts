import { alphaPlane } from './frames';
import { headX } from './motion';

// Dogs and cats walk on a rig: the idle art with its legs sheared back and forth, baked once into N frames
// that share one silhouette (the generated side_N poses are 2 dissimilar drawings, so swapping them pops).

export const puppetSpecies = (species?: string): 'dog' | 'cat' | null => {
  const s = (species ?? '').toLowerCase();
  return /\b(cat|kitten|kitty)s?\b/.test(s) ? 'cat' : /\b(dog|puppy|pup)s?\b/.test(s) ? 'dog' : null;
};

/** What a click-bark says: a cat meows. */
export const barkWord = (species?: string): string => (puppetSpecies(species) === 'cat' ? 'Meow!' : 'Woof!');

/** Which leg rig replaces a pack's walk: none when the drawn walk was picked by a judge model (it reads better than any rig). */
export const rigFor = (species: string | undefined, walk?: { judge?: string }): 'dog' | 'cat' | null => (walk?.judge ? null : puppetSpecies(species));

export interface PuppetGait { frames: number; swing: number; lift: number; lowered: number; bounce: number; pitch: number; tail: { f: number; amp: number; lag: number } }
export const GAITS: Record<'dog' | 'cat', PuppetGait> = {
  dog: { frames: 24, swing: 0.45, lift: 0.22, lowered: 1, bounce: 1.3, pitch: 1, tail: { f: 2, amp: 0.1, lag: 0.6 } },
  cat: { frames: 24, swing: 0.42, lift: 0.15, lowered: 0.97, bounce: 0.6, pitch: 0.6, tail: { f: 1, amp: 0.07, lag: 1.6 } },
};

export interface LegBand { bellyY: number; splitX: number; bottom: number }

/** The rows where the silhouette splits into 2+ legs, counted up from the feet; null when it has none or they are not leg-sized. */
export function legBand(alpha: ArrayLike<number>, w: number, h: number, stride = 1): LegBand | null {
  const solid = (x: number, y: number): boolean => (alpha[(y * w + x) * stride] ?? 0) > 128;
  const runs = (y: number): number => {
    let n = 0;
    let len = 0;
    for (let x = 0; x <= w; x++) {
      if (x < w && solid(x, y)) len++;
      else { if (len >= 3) n++; len = 0; }
    }
    return n;
  };
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (solid(x, y)) { if (top < 0) top = y; bottom = y; break; }
  if (top < 0) return null;
  let bellyY = -1;
  let miss = 0;
  for (let y = bottom; y >= top; y--) {
    if (runs(y) >= 2) { bellyY = y; miss = 0; } else if (bellyY >= 0 && ++miss > 2) break; // feet can merge into one run at the very bottom
  }
  const frac = (bottom - bellyY + 1) / (bottom - top + 1);
  if (bellyY < 0 || frac < 0.08 || frac > 0.45) return null;
  const occ = Array.from({ length: w }, (_, x) => { for (let y = bellyY; y <= bottom; y++) if (solid(x, y)) return true; return false; });
  const lo = occ.indexOf(true);
  const hi = occ.lastIndexOf(true);
  let splitX = (lo + hi) / 2;
  let best = 0;
  for (let x = lo, start = -1; x <= hi; x++) {
    if (!occ[x]) { if (start < 0) start = x; if (x - start + 1 > best) { best = x - start + 1; splitX = (start + x + 1) / 2; } } else start = -1;
  }
  return { bellyY, splitX, bottom };
}

/** Natural px the body must advance per full cycle for the feet not to slide. */
export const cycleStrideNat = (g: PuppetGait, bandH: number): number => 4 * g.swing * bandH;

/** Horizontal offset of the front (or hind, in antiphase) legs' feet at frame k of n; depth01 is 0 at the belly, 1 at the foot. */
export const shearAt = (k: number, n: number, depth01: number, amplitude: number, front: boolean): number =>
  (front ? 1 : -1) * amplitude * depth01 * Math.sin((2 * Math.PI * k) / n);

/** Px a leg pair's feet rise at frame k: only while that pair swings forward (shear increasing), none at the belly. */
export const liftAt = (k: number, n: number, depth01: number, liftPx: number, front: boolean): number =>
  liftPx * depth01 * Math.max(0, (front ? 1 : -1) * Math.cos((2 * Math.PI * k) / n));

/**
 * Side of every leg-band pixel (index (y - bellyY) * w + x): 1 front, 2 hind, 0 none. Each 8-connected component moves as one piece, so a leg that
 * crosses splitX (3/4 view) keeps one side in every row; components under 20 px are dropped.
 */
export function legSides(alpha: ArrayLike<number>, w: number, stride: number, band: LegBand, frontRight: boolean): Uint8Array {
  const rows = band.bottom - band.bellyY + 1;
  const solid = (i: number): boolean => (alpha[(band.bellyY * w + i) * stride] ?? 0) > 128;
  const out = new Uint8Array(w * rows);
  const seen = new Uint8Array(w * rows);
  for (let s = 0; s < w * rows; s++) {
    if (seen[s] || !solid(s)) continue;
    const px: number[] = [s];
    seen[s] = 1;
    let sum = 0;
    for (let n = 0; n < px.length; n++) {
      const p = px[n]!;
      const x = p % w;
      sum += x;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= rows) continue;
        const q = ny * w + nx;
        if (!seen[q] && solid(q)) { seen[q] = 1; px.push(q); }
      }
    }
    if (px.length < 20) continue;
    const front = frontRight ? sum / px.length >= band.splitX : sum / px.length < band.splitX;
    for (const p of px) out[p] = front ? 1 : 2;
  }
  return out;
}

/** Consecutive columns of one strip that share a side (1 front, 2 hind, 0 skip), as runs to draw whole. */
export function stripRuns(sides: ArrayLike<number>): { x0: number; x1: number; front: boolean }[] {
  const out: { x0: number; x1: number; front: boolean }[] = [];
  for (let x = 0, start = 0; x <= sides.length; x++) {
    if (x < sides.length && sides[x] === sides[start]) continue;
    if (sides[start]) out.push({ x0: start, x1: x, front: sides[start] === 1 });
    start = x;
  }
  return out;
}

export interface Tail { x0: number; x1: number; root: number; len: number }

/** The columns strictly behind the rearmost hind-leg pixel in the lower half of the band (2 px margin), or null when they hold under 3% of the opaque pixels or over 30% of the width: a tail wags, a rump does not. */
export function tailColumns(alpha: ArrayLike<number>, w: number, h: number, stride: number, sides: Uint8Array, band: LegBand, frontRight: boolean): Tail | null {
  let edge = frontRight ? w : -1;
  const from = Math.floor((band.bottom - band.bellyY + 1) / 2) * w; // the lower half: up top the hind leg merges with the rump
  for (let i = from; i < sides.length; i++) if (sides[i] === 2) edge = frontRight ? Math.min(edge, i % w) : Math.max(edge, i % w);
  if (edge < 0 || edge >= w) return null;
  const [x0, x1] = frontRight ? [0, edge - 2] : [edge + 3, w];
  let total = 0;
  let inside = 0;
  let tip = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((alpha[(y * w + x) * stride] ?? 0) <= 128) continue;
      total++;
      if (x >= x0 && x < x1) { inside++; tip = tip < 0 ? x : frontRight ? Math.min(tip, x) : Math.max(tip, x); }
    }
  }
  if (inside < 0.03 * total) return null;
  const root = frontRight ? x1 - 1 : x0;
  const len = Math.abs(root - tip);
  return len < 2 || len > 0.3 * w ? null : { x0, x1, root, len };
}

/** Vertical offset (px) of a tail column at distance r (0 root, 1 tip) of the tail at frame k of n; the root never moves and f is whole so the loop is seamless. */
export const tailOffset = (k: number, n: number, r: number, gait: PuppetGait, len: number): number =>
  gait.tail.amp * len * r ** 1.5 * Math.sin((2 * Math.PI * gait.tail.f * k) / n - gait.tail.lag * r);

export interface Baked { srcs: string[]; bitmaps: HTMLImageElement[]; cycleNat: number; centroids: number[] }

export async function bakeWalk(idle: HTMLImageElement, band: LegBand, gait: PuppetGait, alpha?: ArrayLike<number> | null): Promise<Baked> {
  const w = idle.naturalWidth;
  const h = idle.naturalHeight;
  const a = alpha ?? alphaPlane(idle);
  const hx = a && headX(a, w, h, 4);
  const frontRight = hx === null || hx === undefined || hx > band.splitX; // pets face right by default
  const bandH = band.bottom - band.bellyY + 1;
  const amp = gait.swing * bandH;
  const liftPx = gait.lift * bandH;
  if (!a) throw new Error('no canvas');
  const sideOf = legSides(a, w, 4, band, frontRight);
  const tail = tailColumns(a, w, h, 4, sideOf, band, frontRight);
  const strips: { y: number; sh: number; depth: number; runs: ReturnType<typeof stripRuns> }[] = [];
  for (let y = band.bellyY; y < h; y += 2) {
    const sh = Math.min(2, h - y);
    const cols = Array.from({ length: w }, (_, x) => { if (tail && x >= tail.x0 && x < tail.x1) return 0; for (let r = 0; r < sh && y + r <= band.bottom; r++) { const v = sideOf[(y + r - band.bellyY) * w + x]!; if (v) return v; } return 0; });
    strips.push({ y, sh, depth: Math.min(1, (y + sh / 2 - band.bellyY) / bandH), runs: stripRuns(cols) });
  }
  const out: Baked = { srcs: [], bitmaps: [], cycleNat: cycleStrideNat(gait, bandH), centroids: [] };
  const canvases: OffscreenCanvas[] = [];
  for (let k = 0; k < gait.frames; k++) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no canvas');
    ctx.translate(0, h * (1 - gait.lowered)); // crouch toward the ground line
    ctx.scale(1, gait.lowered);
    const bx = tail ? (tail.x0 === 0 ? tail.x1 : 0) : 0; // the tail is drawn by its own pass
    const bw = tail ? w - (tail.x1 - tail.x0) : w;
    ctx.drawImage(idle, bx, 0, bw, band.bellyY, bx, 0, bw, band.bellyY);
    if (tail) {
      for (let x = tail.x0; x < tail.x1; x++) {
        const dy = tailOffset(k, gait.frames, Math.min(1, Math.abs(x - tail.root) / tail.len), gait, tail.len);
        const sx = Math.min(x, w - 2);
        ctx.drawImage(idle, sx, 0, 2, h, sx, dy, 2, h); // 2 source columns: overlap, so a shifted column leaves no gap
      }
    }
    for (const st of strips) {
      for (const r of st.runs) {
        const dx = shearAt(k, gait.frames, st.depth, amp, r.front);
        const dy = liftAt(k, gait.frames, st.depth, liftPx, r.front);
        const sh = Math.min(st.sh + 1, h - st.y); // a row of overlap so strips with different offsets leave no seam
        ctx.drawImage(idle, r.x0, st.y, r.x1 - r.x0, sh, r.x0 + dx, st.y - dy, r.x1 - r.x0, sh);
      }
    }
    const px = ctx.getImageData(0, 0, w, h).data;
    let n = 0;
    let sum = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i]! > 128) { n++; sum += (i >> 2) % w; }
    out.centroids.push(n ? sum / n : 0);
    canvases.push(c);
  }
  const blobs = await Promise.all(canvases.map((c) => c.convertToBlob({ type: 'image/png' })));
  out.bitmaps = blobs.map((b) => Object.assign(new Image(), { src: URL.createObjectURL(b) }));
  out.srcs = out.bitmaps.map((i) => i.src);
  try {
    await Promise.all(out.bitmaps.map((i) => i.decode()));
  } catch (e) {
    out.srcs.forEach((u) => URL.revokeObjectURL(u));
    throw e;
  }
  return out;
}
