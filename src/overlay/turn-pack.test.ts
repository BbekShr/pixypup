import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SpriteManifest } from '../../contracts/types';
import { mirrorProgress, mirrorScale, steer, turnFrame, usableTurn, type Mirror } from './motion';

const husky = JSON.parse(readFileSync(join(__dirname, '__fixtures__/husky-turn/sprite-manifest.json'), 'utf8')) as SpriteManifest;
const TURN_MS = 300;

/** What the overlay draws over a right-to-left turn: the frame name (or 'normal' for the usual pose) and the mirror sign, per 20 ms. */
function simulate(frames: string[] | null): { frame: string; sign: number }[] {
  const m: Mirror = steer({ from: -1, to: 1, at: -Infinity }, -1, 0, TURN_MS);
  const out: { frame: string; sign: number }[] = [];
  for (let t = 0; t < TURN_MS; t += 20) {
    const u = mirrorProgress(m, t, TURN_MS);
    if (!frames) { out.push({ frame: 'normal', sign: Math.sign(mirrorScale(m, t, TURN_MS)) }); continue; }
    const f = turnFrame(u);
    out.push({ frame: f.idx < 2 ? frames[f.idx]! : 'normal', sign: f.mirrorFromFacing ? m.from : m.to });
  }
  return out;
}

describe('a pack with a turnaround', () => {
  const frames = usableTurn(husky.poses['turn']?.frames);
  it('the fixture has the five-frame turnaround at the idle floor line', () => {
    expect(frames).toEqual(['turn_front.png', 'turn_front34.png', 'turn_side.png', 'turn_back34.png', 'turn_back.png']);
    expect(husky.poses['turn']!.footY).toBeCloseTo(husky.poses['idle']!.footY, 6);
  });
  it('turns side -> front34 -> front -> front34 -> side with one mirror flip, at the front view', () => {
    const seq = simulate(frames);
    const names = seq.map((s) => s.frame).filter((f, i, a) => f !== a[i - 1]);
    expect(names).toEqual(['normal', 'turn_front34.png', 'turn_front.png', 'turn_front34.png', 'normal']);
    const flipAt = seq.findIndex((s, i) => i > 0 && s.sign !== seq[i - 1]!.sign);
    expect(seq.filter((s, i) => i > 0 && s.sign !== seq[i - 1]!.sign)).toHaveLength(1);
    expect(seq[flipAt]!.frame).toBe('turn_front.png');
  });
});

describe('a pack without a turnaround', () => {
  it('has none to use, so the turn is the plain hop-turn mirror', () => {
    const poses = Object.fromEntries(Object.entries(husky.poses).filter(([k]) => k !== 'turn'));
    expect(usableTurn(poses['turn']?.frames)).toBeNull();
    expect(usableTurn(['a', 'b'])).toBeNull();
    const seq = simulate(null);
    expect(new Set(seq.map((s) => s.frame))).toEqual(new Set(['normal']));
  });
});
