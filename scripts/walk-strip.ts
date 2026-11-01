// Offline check of a pack's walk art at the real display sizes: no Electron, no API calls.
//
//   npm run walk-strip [-- <packDir>...]        (default: the three packs under assets/pets/)
//
// Per pack and size (src/main/prefs.ts SIZES) it scales idle + side_0..7 by H / idle height (as layout() and shownW do
// in overlay.ts), writes out/walk-strip/<pet>-<size>.png (one row, floor line at footY, centre tick per cell) and the
// scaled frames out/walk-strip/<pet>-<size>-<k>.png, then prints the measured stride and the walking fps per Energy:
// fps = MAX_SPEED * energy.speed * sizeScale / (strideFrac * W), the frame rate walkFrame() plays at (overlay.ts).
// GIF of the walk at a printed fps:
//   ffmpeg -y -framerate <fps> -start_number 1 -i out/walk-strip/<pet>-<size>-%d.png -vf "split[a][b];[a]palettegen[p];[b][p]paletteuse" out/walk-strip/<pet>-<size>-<energy>.gif
// (-0.png is the idle, -1..-8 the walk frames)

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { ENERGIES, SIZES, energyParams, sizeScale } from '../src/main/prefs.js';
import { MAX_SPEED } from '../src/overlay/motion.js';
import { strideFromFrames } from '../src/overlay/stride.js';

const root = join(import.meta.dirname, '..');
const out = join(root, 'out', 'walk-strip');
const packs = process.argv.slice(2);
if (!packs.length) for (const d of (await readdir(join(root, 'assets', 'pets'), { withFileTypes: true }))) if (d.isDirectory()) packs.push(join(root, 'assets', 'pets', d.name));
await mkdir(out, { recursive: true });

for (const dir of packs) {
  const m = JSON.parse(await readFile(join(dir, 'sprite-manifest.json'), 'utf8')) as { pet: string; poses: Record<string, { frames: string[]; footY?: number }> };
  const files = [m.poses['idle']!.frames[0]!, ...m.poses['walk']!.frames].map((f) => join(dir, f));
  const footY = m.poses['idle']!.footY ?? 1;
  const raws = await Promise.all(files.map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const { width: iw, height: ih } = raws[0]!.info;
  const walk = raws.slice(1);
  const sameSize = walk.every((r) => r.info.width === walk[0]!.info.width && r.info.height === walk[0]!.info.height);
  const frac = sameSize ? strideFromFrames(walk.map((r) => r.data), walk[0]!.info.width, walk[0]!.info.height, 4, iw) / iw : NaN;
  console.log(`${m.pet}: idle ${iw}x${ih}, ${walk.length} walk frames${sameSize ? '' : ' (mixed sizes)'}, stride ${frac.toFixed(3)} of idle width`);
  for (const [size, H] of Object.entries(SIZES)) {
    const scale = H / ih;
    const cells = await Promise.all(files.map((f, k) => sharp(f).resize({ width: Math.round(raws[k]!.info.width * scale), height: Math.round(raws[k]!.info.height * scale) }).ensureAlpha().png().toBuffer({ resolveWithObject: true })));
    const W = Math.round(iw * scale);
    const cellW = Math.max(W, ...cells.map((c) => c.info.width)) + 8;
    const overlays: sharp.OverlayOptions[] = [];
    for (const [k, c] of cells.entries()) {
      await writeFile(join(out, `${m.pet}-${size}-${k}.png`), c.data);
      const left = k * cellW + Math.round((cellW - c.info.width) / 2);
      overlays.push({ input: c.data, left, top: 0 });
      overlays.push({ input: { create: { width: 1, height: H, channels: 4, background: '#ff00ff66' } }, left: k * cellW + (cellW >> 1), top: 0 });
    }
    overlays.push({ input: { create: { width: cellW * cells.length, height: 1, channels: 4, background: '#00aaffcc' } }, left: 0, top: Math.min(H - 1, Math.round(H * footY)) });
    await sharp({ create: { width: cellW * cells.length, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } }).composite(overlays).png().toFile(join(out, `${m.pet}-${size}.png`));
    const fps = ENERGIES.map((e) => `${e} ${((MAX_SPEED * energyParams(e).speed * sizeScale(size as keyof typeof SIZES)) / (frac * W)).toFixed(1)}`);
    console.log(`  ${size.padEnd(6)} H=${H} W=${W}  fps: ${fps.join(', ')}`);
  }
}
console.log('wrote out/walk-strip/');
