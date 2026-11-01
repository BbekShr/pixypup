// Old packs have walk frames where the slicer cut through a neighbouring frame's tail, leaving a detached sliver on the left or right edge.

const SLIVER = 0.03; // of the largest component's pixels

/**
 * Pixel indices (y * w + x) of every connected opaque component that is under 3% of the largest AND touches the
 * left or right edge column that the main body itself does not touch. The main body is never listed. `stride` is the step
 * between alpha samples (4 for the alpha plane of RGBA data).
 */
export function edgeSlivers(alpha: ArrayLike<number>, w: number, h: number, stride = 1): number[] {
  const solid = (i: number): boolean => (alpha[i * stride] ?? 0) > 128;
  const seen = new Uint8Array(w * h);
  const comps: { px: number[]; left: boolean; right: boolean }[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || !solid(s)) continue;
    const comp = { px: [] as number[], left: false, right: false };
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const p = stack.pop()!;
      comp.px.push(p);
      const x = p % w;
      const y = (p - x) / w;
      if (x === 0) comp.left = true;
      if (x === w - 1) comp.right = true;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (!seen[n] && solid(n)) { seen[n] = 1; stack.push(n); }
        }
      }
    }
    comps.push(comp);
  }
  const body = comps.reduce((a, c) => (c.px.length > a.px.length ? c : a), { px: [] as number[], left: false, right: false });
  // A real detached tip on a frame whose body already runs to that edge is art, not a slicer artefact.
  return comps.filter((c) => c !== body && c.px.length < SLIVER * body.px.length && ((c.left && !body.left) || (c.right && !body.right))).flatMap((c) => c.px);
}

/** A decoded copy of the frame with its edge slivers erased (a blob: URL), or null when it has none or cannot be cleaned: keep the original. */
export async function cleanFrame(img: HTMLImageElement): Promise<HTMLImageElement | null> {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  const bad = edgeSlivers(data.data.subarray(3), w, h, 4);
  if (bad.length === 0) return null;
  for (const p of bad) data.data[p * 4 + 3] = 0;
  ctx.putImageData(data, 0, 0);
  const out = new Image();
  out.src = URL.createObjectURL(await c.convertToBlob({ type: 'image/png' }));
  await out.decode();
  return out;
}
