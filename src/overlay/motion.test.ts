import { describe, expect, it } from 'vitest';
import { BLINK_MS, MAX_SPEED, SETTLE_MS, barkPose, blinkDelay, bob, envelope, fall, gait, headX, lean, overlap, petTransform, settle, walkFrame, breathe, hop, pickTarget, rollAngle, squash, walkSpeed } from './motion';
import { displayWidth, footOffset } from './layout';

describe('layout', () => {
  it('puts the foot line at footY of the displayed height and keeps aspect', () => {
    expect(footOffset(140, 0.993)).toBeCloseTo(139.02);
    expect(displayWidth(212, 288)).toBeCloseTo(103.06, 1);
  });
});

describe('motion', () => {
  it('eases in, cruises at max, eases out, never stalls', () => {
    expect(walkSpeed(0, 500)).toBe(8);
    expect(walkSpeed(150, 500)).toBeCloseTo(MAX_SPEED / 2);
    expect(walkSpeed(2000, 500)).toBe(MAX_SPEED);
    expect(walkSpeed(2000, 5)).toBeLessThan(MAX_SPEED / 2);
    expect(walkSpeed(2000, 0)).toBeGreaterThan(0);
  });
  it('wander targets are 120-400 px away and inside the window', () => {
    for (const [x, r1, r2] of [[500, 0, 0], [500, 1, 1], [10, 0, 0.5], [900, 1, 0.5], [0, 0.9, 0]] as const) {
      const t = pickTarget(x, 1000, 500, r1, r2);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1000);
      expect(Math.abs(t - x)).toBeGreaterThanOrEqual(120 - 1e-9);
      expect(Math.abs(t - x)).toBeLessThanOrEqual(400);
    }
  });
  it('heads home when far from it', () => {
    expect(pickTarget(900, 1000, 300, 0.9, 0)).toBeLessThan(900);
  });
  it('walk frames advance one per stride of distance and wrap over N frames', () => {
    expect(walkFrame(0, 2, 20)).toBe(0);
    expect(walkFrame(19.9, 2, 20)).toBe(0);
    expect(walkFrame(20, 2, 20)).toBe(1);
    expect(walkFrame(40, 2, 20)).toBe(0);
    expect(walkFrame(79, 4, 20)).toBe(3);
    expect(walkFrame(80, 4, 20)).toBe(0);
  });
  it('bob is 0 at a footfall, 4 px up mid-stride, and frozen when standing still', () => {
    expect(bob(0, 20)).toBeCloseTo(0);
    expect(bob(20, 20)).toBeCloseTo(0);
    expect(bob(10, 20)).toBeCloseTo(-4);
  });
  it('leans toward the travel direction and the transform keeps that sign when mirrored', () => {
    expect(lean(1)).toBe(2);
    expect(lean(-1)).toBe(-2);
    expect(petTransform(10, 20, lean(-1), -1, 1, 1)).toBe('translate(10px, 20px) rotate(-2deg) scale(-1, 1)');
    expect(petTransform(10, 20, lean(1), 1, 1.06, 0.92)).toBe('translate(10px, 20px) rotate(2deg) scale(1.06, 0.92)');
  });
  it('breathing stays within [1, 1+amp]', () => {
    for (let t = 0; t < 5000; t += 137) {
      expect(breathe(t, 0.4, 0.025)).toBeGreaterThanOrEqual(1);
      expect(breathe(t, 0.4, 0.025)).toBeLessThanOrEqual(1.025 + 1e-9);
    }
  });
  it('hop peaks at -14 px, lands on the floor squashed, then recovers', () => {
    expect(hop(125).dy).toBeCloseTo(-14);
    expect(hop(0).dy).toBeCloseTo(0);
    expect(hop(250)).toEqual({ dy: 0, sy: expect.closeTo(0.92) });
    expect(hop(400).sy).toBe(1);
  });
  it('roll is one full turn', () => {
    expect(rollAngle(0)).toBe(0);
    expect(rollAngle(350)).toBeCloseTo(180);
    expect(rollAngle(5000)).toBe(360);
  });
  it('squash recovers linearly', () => {
    expect(squash(0, 0.06, 150)).toBeCloseTo(0.94);
    expect(squash(150, 0.06, 150)).toBe(1);
  });
});

describe('fall', () => {
  const run = (lift: number) => {
    let l = lift, v = 0, impacts = 0, maxV = 0, peak = 0, steps = 0, settled = false;
    while (!settled && steps++ < 1000) {
      const r = fall(l, v, 1 / 60);
      l = r.lift; v = r.vy; settled = r.settled;
      if (r.impact) impacts++;
      maxV = Math.max(maxV, v);
      if (impacts) peak = Math.max(peak, -l);
    }
    return { l, impacts, maxV, peak, steps, settled };
  };
  it('lands on the floor from anywhere, with speed capped, one impact and a ~12 px bounce', () => {
    const r = run(-700);
    expect(r.settled).toBe(true);
    expect(r.l).toBe(0);
    expect(r.impacts).toBe(1);
    expect(r.maxV).toBeLessThanOrEqual(1400);
    expect(r.peak).toBeGreaterThan(8);
    expect(r.peak).toBeLessThan(14);
  });
  it('a tiny drop settles without an impact bounce', () => {
    const r = run(-3);
    expect(r.impacts).toBe(0);
    expect(r.settled).toBe(true);
  });
  it('a pet below the floor is pulled back to it', () => {
    expect(run(50).l).toBe(0);
  });
});

describe('blink', () => {
  it('waits 3-6 s between blinks and holds the frame ~120 ms', () => {
    expect(blinkDelay(0)).toBe(3000);
    expect(blinkDelay(0.999)).toBeLessThan(6000);
    expect(BLINK_MS).toBe(120);
  });
});

describe('walkSpeed cap', () => {
  it('a custom max is reached and never exceeded, and still arrives', () => {
    expect(walkSpeed(2000, 500, 126)).toBe(126);
    expect(walkSpeed(2000, 500, 54)).toBe(54);
    expect(walkSpeed(2000, 0.1, 54)).toBeGreaterThanOrEqual(8);
  });
  it('display width follows the chosen height', () => {
    expect(displayWidth(200, 100, 180)).toBe(360);
    expect(displayWidth(200, 100, 110)).toBe(220);
  });
});

// w x h alpha mask from rows of '#' (opaque) and '.' (clear)
const mask = (rows: string[]): number[] => rows.flatMap((r) => [...r].map((c) => (c === '#' ? 255 : 0)));

describe('frame registration', () => {
  const idle = mask(['.##.......', '.##.......', '####......', '#########.', '#########.', '#.#.#..#..', '#.#.#..#..', '#.#.#..#..', '#.#.#..#..', '#.#.#..#..']);
  const walk = mask(['....##....', '....##....', '...####...', '.#########', '.#########', '.#.#.#..#.', '..#.#..#..', '.#....#..#', '.#....#..#', '.#....#..#']);
  it('finds the head from the top 30% of the silhouette, ignoring the legs', () => {
    expect(headX(idle, 10, 10)).toBeCloseTo(1.5);
    expect(headX(walk, 10, 10)! - headX(idle, 10, 10)!).toBeCloseTo(3);
  });
  it('reads RGBA data with a stride and returns null for a blank frame', () => {
    const rgba = idle.flatMap((a) => [0, 0, 0, a]);
    expect(headX(rgba.slice(3), 10, 10, 4)).toBeCloseTo(1.5);
    expect(headX(new Array(100).fill(0), 10, 10)).toBeNull();
  });
  it('overlap is 1 for the same frame and drops as frames differ', () => {
    expect(overlap(idle, idle)).toBe(1);
    expect(overlap(idle, walk)).toBeLessThan(0.6);
    expect(overlap([0, 0], [0, 0])).toBe(0);
  });
});

describe('gait, bark, settle', () => {
  it('squashes at each footfall, stretches mid-stride, rocks the other way every step', () => {
    expect(gait(0, 20).sy).toBeCloseTo(0.985);
    expect(gait(10, 20).sy).toBeCloseTo(1.015);
    expect(gait(10, 20).sx).toBeLessThan(1);
    expect(gait(10, 20).rot).toBeCloseTo(1.2);
    expect(gait(30, 20).rot).toBeCloseTo(-1.2);
    expect(gait(10, 20).dy).toBe(bob(10, 20));
  });
  it('each woof winds up (nose down, crouch) then pops (nose up, chest up), and is calm between bursts', () => {
    const wind = barkPose(140);
    expect(wind.rot).toBeLessThan(0);
    expect(wind.sy).toBeLessThan(1);
    const pop = barkPose(180);
    expect(pop.rot).toBeCloseTo(5);
    expect(pop.sy).toBeCloseTo(1.06);
    expect(pop.dx).toBeGreaterThan(0);
    expect(barkPose(1200).rot).toBeCloseTo(0, 1);
    expect(barkPose(1400 + 180).rot).toBeCloseTo(5); // repeats
  });
  it('settle dips, overshoots, and is done by SETTLE_MS', () => {
    expect(settle(0)).toBeCloseTo(0.94);
    expect(settle(130)).toBeGreaterThan(1);
    expect(settle(SETTLE_MS)).toBe(1);
    expect(settle(-5)).toBe(1);
  });
  it('envelope eases in and out and is 0 outside its span', () => {
    expect(envelope(0, 1000)).toBe(0);
    expect(envelope(500, 1000)).toBeCloseTo(1);
    expect(envelope(1000, 1000)).toBe(0);
    expect(envelope(250, 1000)).toBeCloseTo(0.5);
  });
});
