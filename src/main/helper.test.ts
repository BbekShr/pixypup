import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bin = 'native/bin/pixyhelper';
const ready = existsSync(bin);
if (!ready) console.warn(`SKIP helper tests: ${bin} missing (run npm run build-native; needs swiftc)`);

describe.skipIf(!ready)('pixyhelper', () => {
  it('windows prints JSON with a windows array', () => {
    const r = spawnSync(bin, ['windows'], { encoding: 'utf8', timeout: 5000 });
    const j = JSON.parse(r.stdout);
    expect(Array.isArray(j.windows)).toBe(true);
    expect(typeof j.titlesRedacted).toBe('boolean');
  });
  it('unknown subcommand exits 2', () => {
    expect(spawnSync(bin, ['nope'], { timeout: 5000 }).status).toBe(2);
  });
});
