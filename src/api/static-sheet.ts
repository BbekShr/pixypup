import sharp from 'sharp';

const SAME = 0.97;
const H = 64;

/** Alpha mask of a frame scaled to height H and centred on a w x H canvas. */
async function mask(png: Buffer, w: number): Promise<Uint8Array> {
  const f = await sharp(png).resize({ height: H }).ensureAlpha().png().toBuffer();
  const fw = ((await sharp(f).metadata()).width as number);
  const { data } = await sharp({ create: { width: w, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: f, left: Math.floor((w - fw) / 2), top: 0 }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Uint8Array.from({ length: w * H }, (_, i) => ((data[i * 4 + 3] as number) > 128 ? 1 : 0));
}

/** True when every pair of frames has alpha IoU >= 0.97 at a common height: a "walk" that never moves. */
export async function isStaticSheet(frames: { png: Buffer }[]): Promise<boolean> {
  const sizes = await Promise.all(frames.map((f) => sharp(f.png).metadata()));
  const w = Math.max(...sizes.map((m) => Math.max(1, Math.round(((m.width as number) * H) / (m.height as number)))));
  const masks = await Promise.all(frames.map((f) => mask(f.png, w)));
  for (let i = 0; i < masks.length; i++)
    for (let j = i + 1; j < masks.length; j++) {
      let both = 0;
      let either = 0;
      for (let k = 0; k < w * H; k++) {
        const p = masks[i]![k]!;
        const q = masks[j]![k]!;
        both += p & q;
        either += p | q;
      }
      if (either && both / either < SAME) return false;
    }
  return true;
}
