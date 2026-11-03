// Measures the walk art itself so the feet don't slide: how far the body advances per walk frame.

export const FALLBACK_STRIDE = 0.22; // of the body width, when the art gives no answer
const BAND = 0.06; // of the image height: the rows that hold a planted foot
const MIN_SCORE = 0.3;

/** Columns that have an opaque pixel in the bottom band of the silhouette: the planted feet. */
function planted(alpha: ArrayLike<number>, w: number, h: number, stride: number): Uint8Array {
  const cols = new Uint8Array(w);
  let bottom = -1;
  for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if ((alpha[(y * w + x) * stride] ?? 0) > 128) { bottom = y; break; }
  if (bottom < 0) return cols;
  for (let y = Math.max(0, bottom - Math.round(BAND * h)); y <= bottom; y++) for (let x = 0; x < w; x++) if ((alpha[(y * w + x) * stride] ?? 0) > 128) cols[x] = 1;
  return cols;
}

/** The shift d in [lo, hi] that best lays frame a's feet over frame b's after moving left by d, with its overlap score. */
function bestShift(a: Uint8Array, b: Uint8Array, lo: number, hi: number): { d: number; score: number } {
  const na = a.reduce((s, v) => s + v, 0);
  const nb = b.reduce((s, v) => s + v, 0);
  let best = { d: 0, score: 0 };
  for (let d = lo; d <= hi; d++) {
    let inter = 0;
    for (let x = 0; x + d < a.length; x++) if (a[x + d] && b[x]) inter++;
    const score = inter / Math.max(1, na + nb - inter);
    if (score > best.score) best = { d, score };
  }
  return best;
}

/**
 * Px (in the frames' own pixels) the body advances per walk frame: a planted foot moves back in the frame by exactly
 * that much from one frame to the next. Median over consecutive pairs (including the wrap), clamped to
 * [0.08, 0.4] x bodyW; FALLBACK_STRIDE x bodyW when no pair lines up. `stride` is the step between alpha samples.
 * A pair whose best shift sits on the lower clamp is skipped: its feet barely moved (Muse Image often draws two
 * near-identical steps), and counting it dragged a whole walk to the floor so the legs pedalled ~3x too fast (Milo).
 */
export function strideFromFrames(alphas: ArrayLike<number>[], w: number, h: number, stride: number, bodyW = w): number {
  const lo = Math.ceil(0.08 * bodyW);
  const hi = Math.floor(0.4 * bodyW);
  const fallback = FALLBACK_STRIDE * bodyW;
  if (alphas.length < 2) return fallback;
  const feet = alphas.map((a) => planted(a, w, h, stride));
  const found: number[] = [];
  for (let i = 0; i < feet.length; i++) {
    const r = bestShift(feet[i]!, feet[(i + 1) % feet.length]!, lo, hi);
    if (r.score >= MIN_SCORE && r.d > lo) found.push(r.d);
  }
  if (found.length === 0) return fallback;
  found.sort((p, q) => p - q);
  const mid = found.length >> 1;
  const median = found.length % 2 ? found[mid]! : (found[mid - 1]! + found[mid]!) / 2;
  return Math.min(hi, Math.max(lo, median));
}
