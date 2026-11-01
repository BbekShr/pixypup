import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { headX, registersByHead } from './motion';

describe('walk registration', () => {
  it('skips drawn walks (own size) but not same-size walks or other poses', () => {
    expect(registersByHead('walk', false)).toBe(false);
    expect(registersByHead('walk', true)).toBe(true);
    expect(registersByHead('sit', false)).toBe(true);
  });

  it('is needed: head x of the real drawn Pakkun walk swings past the 15% clamp registration would apply', async () => {
    const dir = join(__dirname, '../../assets/pets/Pakkun');
    const xs: number[] = [];
    let w = 0;
    for (let k = 0; k < 8; k++) {
      const { data, info } = await sharp(readFileSync(join(dir, `side_${k}.png`))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      w = info.width;
      xs.push(headX(data, info.width, info.height, 4)! - info.width / 2);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.1 * w);
  });
});
