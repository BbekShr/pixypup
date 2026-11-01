// Reproducible app icon: 3D Pakkun on a cream rounded square -> build/icon.icns (run: npx tsx scripts/make-icon.mts)
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import sharp from 'sharp'

const SIT = 'assets/pets/Pakkun/sit.png'
const set = 'build/icon.iconset'

async function master(size: number, face: boolean): Promise<Buffer> {
  const pad = size * 0.098
  const tile = size - pad * 2
  const r = tile * 0.225
  const bg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="${size * 0.012}" stdDeviation="${size * 0.014}" flood-color="#E8A0A8" flood-opacity="0.55"/></filter>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFAF3"/><stop offset="1" stop-color="#FFEBDA"/></linearGradient>
      </defs>
      <rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${r}" fill="url(#g)" filter="url(#s)"/>
    </svg>`,
  )
  // small sizes: crop to the face so it still reads at 16 px
  const src = face
    ? sharp(SIT).extract({ left: 55, top: 0, width: 135, height: 135 })
    : sharp(SIT)
  const h = Math.round(tile * (face ? 0.86 : 0.76))
  const dog = await src.resize({ height: h, fit: 'inside', kernel: 'lanczos3' }).toBuffer()
  const m = await sharp(dog).metadata()
  return sharp(bg)
    .composite([{ input: dog, left: Math.round((size - m.width!) / 2), top: Math.round(pad + (tile - h) / 2 + (face ? 0 : tile * 0.02)) }])
    .png()
    .toBuffer()
}

rmSync(set, { recursive: true, force: true })
mkdirSync(set, { recursive: true })
const full = await master(1024, false)
for (const base of [16, 32, 128, 256, 512]) {
  for (const x2 of [1, 2]) {
    const px = base * x2
    const buf = px <= 64 ? await master(px * 4, true) : full
    await sharp(buf).resize(px, px, { kernel: 'lanczos3' }).toFile(`${set}/icon_${base}x${base}${x2 === 2 ? '@2x' : ''}.png`)
  }
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', 'build/icon.icns'])
rmSync(set, { recursive: true })
await sharp(full).resize(512).toFile('out/f10-icon-preview.png').catch(() => undefined)
console.log('wrote build/icon.icns')
