// DMG window art -> build/dmg-background.png (+@2x) and out/f10-dmg-preview.png (run: npx tsx scripts/make-dmg-art.mts)
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const W = 640
const H = 420
// keep in sync with build.dmg.contents in package.json
export const APP = { x: 215, y: 200 }
export const APPS = { x: 470, y: 200 }
const FONT = `'Marker Felt', 'Chalkboard SE', ui-rounded, 'SF Pro Rounded', -apple-system, sans-serif`

const paw = (x: number, y: number, r: number) =>
  `<g transform="translate(${x} ${y}) rotate(${r})" fill="#F3C9C4" opacity="0.45">
    <ellipse cx="0" cy="6" rx="9" ry="7.5"/><ellipse cx="-11" cy="-5" rx="3.6" ry="4.6"/><ellipse cx="-4" cy="-11" rx="3.6" ry="4.8"/>
    <ellipse cx="4" cy="-11" rx="3.6" ry="4.8"/><ellipse cx="11" cy="-5" rx="3.6" ry="4.6"/></g>`
const paws = []
for (let row = 0; row < 6; row++)
  for (let col = 0; col < 9; col++)
    paws.push(paw(30 + col * 80 + (row % 2) * 40, 30 + row * 72, ((row * 7 + col * 13) % 50) - 25))

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#FFF6EC"/>
  ${paws.join('')}
  <rect width="${W}" height="${H}" fill="#FFF6EC" opacity="0.35"/>
  <text x="${W / 2}" y="62" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="#8A5A4A">Welcome to PixyPup</text>
  <path d="M 292 168 C 335 110, 390 110, 424 160" fill="none" stroke="#E58F8F" stroke-width="5" stroke-linecap="round" stroke-dasharray="14 9"/>
  <path d="M 410 142 L 426 163 L 400 169" fill="none" stroke="#E58F8F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="358" y="98" text-anchor="middle" font-family="${FONT}" font-size="24" fill="#C0605F" transform="rotate(-4 358 98)">Drag me home</text>
  <text x="${W / 2}" y="398" text-anchor="middle" font-family="${FONT}" font-size="12.5" fill="#9A7B6E">First open: right-click PixyPup → Open (indie app, not notarised yet)</text>
</svg>`

const dog = await sharp('assets/pets/Pakkun/sit.png').resize({ height: 170 }).toBuffer()
const dogM = await sharp(dog).metadata()
const layer = { input: dog, left: 6, top: H - 170 - 34 }

mkdirSync('build', { recursive: true })
mkdirSync('out', { recursive: true })
const base = (scale: number) =>
  sharp(Buffer.from(svg), { density: 72 * scale })
    .resize(W * scale, H * scale)
    .png()
const dogAt = async (scale: number) => ({
  input: await sharp(dog).resize({ height: 170 * scale }).toBuffer(),
  left: layer.left * scale,
  top: layer.top * scale,
})
for (const [s, name] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']] as const)
  await sharp(await base(s).toBuffer()).composite([await dogAt(s)]).toFile(`build/${name}`)

// preview: background + the two icons where Finder will put them (labels drawn like Finder's)
const ICON = 100
const appIcon = await sharp('build/icon.icns').resize(ICON, ICON).png().toBuffer().catch(async () =>
  sharp('out/f10-icon-preview.png').resize(ICON, ICON).png().toBuffer())
const folder = Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}"><rect x="8" y="22" width="84" height="64" rx="10" fill="#6CB4EE"/><rect x="8" y="14" width="34" height="14" rx="6" fill="#4A9BDB"/><rect x="8" y="30" width="84" height="56" rx="10" fill="#8CC8F8"/></svg>`)
const label = (t: string, x: number) =>
  `<text x="${x}" y="${APP.y + ICON / 2 + 20}" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="#333">${t}</text>`
const labels = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${label('PixyPup', APP.x)}${label('Applications', APPS.x)}</svg>`)
await sharp('build/dmg-background.png')
  .composite([
    { input: appIcon, left: APP.x - ICON / 2, top: APP.y - ICON / 2 },
    { input: folder, left: APPS.x - ICON / 2, top: APPS.y - ICON / 2 },
    { input: labels },
  ])
  .toFile('out/f10-dmg-preview.png')
console.log('wrote build/dmg-background*.png, out/f10-dmg-preview.png', dogM.width)
