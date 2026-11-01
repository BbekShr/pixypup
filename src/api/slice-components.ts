// Cut a keyed sprite sheet into frames by connected components instead of vertical columns: Muse frames nearly
// touch, so a column cut clips the next frame's tail tip and hands it to the previous frame as a sliver.
// Pure (no sharp). Null when the bodies are merged or implausible; the caller falls back to the column cut.

export interface Crop {
  data: Buffer;
  width: number;
  height: number;
}

interface Comp {
  area: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** n frames in reading order; `rows` > 1 lays them on a grid of that many rows. */
export function sliceComponents(rgba: Buffer, w: number, h: number, n: number, rows = 1): Crop[] | null {
  const label = new Int32Array(w * h);
  const comps: Comp[] = [{ area: 0, x0: 0, y0: 0, x1: 0, y1: 0 }]; // index 0 = unlabelled
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (label[start] || (rgba[start * 4 + 3] as number) <= 128) continue;
    const id = comps.length;
    const c: Comp = { area: 0, x0: w, y0: h, x1: -1, y1: -1 };
    comps.push(c);
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (label[q] || (rgba[q * 4 + 3] as number) <= 128) continue;
          label[q] = id;
          stack.push(q);
        }
      }
    }
  }
  const order = comps.map((_, i) => i).slice(1).sort((a, b) => (comps[b] as Comp).area - (comps[a] as Comp).area);
  if (order.length < n) return null;
  const largest = (comps[order[0] as number] as Comp).area;
  // The n bodies must be comparable in size; a smaller nth means two bodies fused into one component.
  if ((comps[order[n - 1] as number] as Comp).area < 0.3 * largest) return null;
  const cx = (i: number) => (comps[i] as Comp).x0 + (comps[i] as Comp).x1;
  const cy = (i: number) => (comps[i] as Comp).y0 + (comps[i] as Comp).y1;
  const bodies: number[] = [];
  const perRow = n / rows;
  const byY = order.slice(0, n).sort((a, b) => cy(a) - cy(b));
  for (let r = 0; r < rows; r++) bodies.push(...byY.slice(r * perRow, (r + 1) * perRow).sort((a, b) => cx(a) - cx(b)));
  // Rows must not interleave: every body of a row sits above every body of the next.
  for (let r = 1; r < rows; r++) {
    const upper = Math.max(...bodies.slice((r - 1) * perRow, r * perRow).map(cy));
    if (upper >= Math.min(...bodies.slice(r * perRow, (r + 1) * perRow).map(cy))) return null;
  }
  const widths = bodies.map((b) => (comps[b] as Comp).x1 - (comps[b] as Comp).x0 + 1).sort((a, b) => a - b);
  const median = widths[Math.floor(n / 2)] as number;
  if (widths.some((v) => Math.abs(v - median) > 0.5 * median)) return null;

  const group = new Int32Array(comps.length).fill(-1);
  bodies.forEach((b, g) => (group[b] = g));
  const speck = Math.max(10, 0.0003 * largest);
  // Boundary pixels per component: a small piece joins the body it is truly closest to, not the one whose bbox it overlaps.
  const edge = new Map<number, number[]>();
  for (let p = 0; p < w * h; p++) {
    const l = label[p] as number;
    if (!l || (comps[l] as Comp).area < speck) continue;
    const x = p % w;
    if (x === 0 || x === w - 1 || p < w || p >= w * (h - 1) || label[p - 1] !== l || label[p + 1] !== l || label[p - w] !== l || label[p + w] !== l) {
      if (!edge.has(l)) edge.set(l, []);
      (edge.get(l) as number[]).push(p);
    }
  }
  const gap = (a: number[], b: number[]) => {
    let best = Infinity;
    for (const p of a) {
      for (const q of b) {
        const dx = (p % w) - (q % w);
        const dy = Math.floor(p / w) - Math.floor(q / w);
        best = Math.min(best, dx * dx + dy * dy);
      }
    }
    return best;
  };
  for (const i of order.slice(n)) {
    if ((comps[i] as Comp).area < speck) continue;
    let best = 0;
    let bestD = Infinity;
    bodies.forEach((b, g) => {
      const d = gap(edge.get(i) as number[], edge.get(b) as number[]);
      if (d < bestD) [best, bestD] = [g, d];
    });
    group[i] = best;
  }
  const box = bodies.map(() => ({ x0: w, y0: h, x1: -1, y1: -1 }));
  comps.forEach((c, i) => {
    const b = box[group[i] as number];
    if (!b || i === 0) return;
    b.x0 = Math.min(b.x0, c.x0);
    b.x1 = Math.max(b.x1, c.x1);
    b.y0 = Math.min(b.y0, c.y0);
    b.y1 = Math.max(b.y1, c.y1);
  });
  return box.map((b, g) => {
    const cw = b.x1 - b.x0 + 1;
    const ch = b.y1 - b.y0 + 1;
    const data = Buffer.alloc(cw * ch * 4);
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const p = y * w + x;
        const l = label[p] as number;
        // Faint anti-aliased fringe has no label: keep it unless it lies in another frame's box.
        const mine = l ? group[l] === g : !box.some((o, k) => k !== g && x >= o.x0 && x <= o.x1 && y >= o.y0 && y <= o.y1);
        if (mine && (rgba[p * 4 + 3] as number) > 0) rgba.copy(data, ((y - b.y0) * cw + (x - b.x0)) * 4, p * 4, p * 4 + 4);
      }
    }
    return { data, width: cw, height: ch };
  });
}
