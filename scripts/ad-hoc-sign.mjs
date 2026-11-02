// electron-builder skips signing when identity is null, which leaves the edited bundle with a
// broken signature (Apple Silicon refuses it). Re-sign: helper first, then the whole app.
// A local "PixyPup Dev" certificate (or PIXY_SIGN_IDENTITY) keeps the signature stable across rebuilds,
// so macOS keeps its Terminal, Accessibility and Screen Recording grants; without one, sign ad hoc.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

function identity() {
  if (process.env.PIXY_SIGN_IDENTITY) return process.env.PIXY_SIGN_IDENTITY
  try {
    // no -v: a self-signed certificate is "not trusted" but still signs fine
    return execFileSync('security', ['find-identity', '-p', 'codesigning'], { encoding: 'utf8' }).includes('"PixyPup Dev"') ? 'PixyPup Dev' : '-'
  } catch {
    return '-'
  }
}

export default async function (context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const helper = path.join(app, 'Contents/Resources/pixyhelper')
  const id = identity()
  process.stdout.write(`  • signing with ${id === '-' ? 'ad hoc' : id}\n`)
  execFileSync('chmod', ['755', helper])
  execFileSync('codesign', ['--force', '-s', id, helper])
  execFileSync('codesign', ['--force', '--deep', '-s', id, app])
}
