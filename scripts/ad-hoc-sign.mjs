// electron-builder skips signing when identity is null, which leaves the edited bundle with a
// broken signature (Apple Silicon refuses it). Re-sign ad hoc: helper first, then the whole app.
import { execFileSync } from 'node:child_process'
import path from 'node:path'

export default async function (context) {
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const helper = path.join(app, 'Contents/Resources/pixyhelper')
  execFileSync('chmod', ['755', helper])
  execFileSync('codesign', ['--force', '-s', '-', helper])
  execFileSync('codesign', ['--force', '--deep', '-s', '-', app])
}
