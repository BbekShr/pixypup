import { describe, expect, it } from 'vitest';
import { BLINK_MS, MAX_SPEED, SETTLE_MS, barkPose, woofBurst, blinkDelay, bob, envelope, airStep, dangle, gait, headX, landSquash, pivotShift, releaseVelocity, lean, overlap, petTransform, settle, walkFrame, breathe, hop, pickTarget, rollAngle, squash, walkSpeed } from './motion';
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

describe('airStep', () => {
  const run = (lift: number, vx = 0, maxX = 1000, x = 500) => {
    let b = { x, lift, vx, vy: 0 };
    const apexes: number[] = [];
    let steps = 0, maxV = 0, settled = false, minX = x, maxSeen = x;
    const speeds: number[] = [];
    while (!settled && steps++ < 2000) {
      const r = airStep(b, 1 / 60, maxX, 1e9);
      if (b.vy < 0 && r.vy >= 0) apexes.push(-r.lift);
      b = r;
      settled = r.settled;
      maxV = Math.max(maxV, r.vy);
      minX = Math.min(minX, r.x);
      maxSeen = Math.max(maxSeen, r.x);
      speeds.push(r.vx);
    }
    return { b, apexes, steps, maxV, settled, minX, maxSeen, speeds };
  };
  it('a 600 px drop bounces at least twice, each apex lower, and settles in bounded time', () => {
    const r = run(-600);
    expect(r.settled).toBe(true);
    expect(r.b.lift).toBe(0);
    expect(r.apexes.length).toBeGreaterThanOrEqual(2);
    r.apexes.slice(1).forEach((a, i) => expect(a).toBeLessThan(r.apexes[i]!));
    expect(r.steps).toBeLessThan(240);
    expect(r.maxV).toBeLessThanOrEqual(1400);
  });
  it('a 10 px drop barely bounces', () => {
    expect(Math.max(0, ...run(-10).apexes)).toBeLessThan(2);
  });
  it('a pet below the floor is pulled back to it', () => {
    expect(run(50).b.lift).toBe(0);
  });
  it('a throw at the wall stays inside [0, maxX] and comes back slower', () => {
    const r = run(-100, 1500, 700, 600);
    expect(r.minX).toBeGreaterThanOrEqual(0);
    expect(r.maxSeen).toBeLessThanOrEqual(700);
    const hit = r.speeds.findIndex((v) => v < 0);
    expect(hit).toBeGreaterThan(0);
    expect(Math.abs(r.speeds[hit]!)).toBeLessThan(1500);
  });
  it('an upward flick bounces off the top of the window, but a pet spawned above it falls in', () => {
    let b = { x: 100, lift: -50, vx: 0, vy: -1600 };
    let top = 0;
    for (let i = 0; i < 300; i++) { b = airStep(b, 1 / 60, 500, 300); top = Math.min(top, b.lift); }
    expect(top).toBeGreaterThanOrEqual(-300);
    const spawn = airStep({ x: 100, lift: -900, vx: 0, vy: 0 }, 1 / 60, 500, 300);
    expect(spawn.lift).toBeGreaterThan(-900);
  });
  it('a floor slide slows monotonically to rest', () => {
    let b = { x: 100, lift: 0, vx: 600, vy: 0 };
    let prev = 600, steps = 0;
    for (; steps < 600; steps++) {
      const r = airStep(b, 1 / 60, 5000, 1e9);
      expect(Math.abs(r.vx)).toBeLessThanOrEqual(prev);
      prev = Math.abs(r.vx);
      b = r;
      if (r.settled) break;
    }
    expect(b.vx).toBe(0);
    expect(b.x).toBeGreaterThan(100);
    expect(steps).toBeLessThan(120);
  });
});

describe('releaseVelocity', () => {
  const flick = (v: number, until = 1000) => Array.from({ length: 10 }, (_, i) => ({ x: (v * (i * 16)) / 1000, y: 0, t: until - (9 - i) * 16 }));
  it('a steady flick returns its speed', () => {
    expect(releaseVelocity(flick(800), 1005).vx).toBeGreaterThan(720);
    expect(releaseVelocity(flick(800), 1005).vx).toBeLessThan(880);
  });
  it('a pointer held still before release returns 0', () => {
    expect(releaseVelocity(flick(800), 1100)).toEqual({ vx: 0, vy: 0 });
  });
  it('huge flicks are clamped', () => {
    const v = releaseVelocity(flick(20000), 1005);
    expect(Math.hypot(v.vx, v.vy)).toBeLessThanOrEqual(1600.001);
  });
});

describe('dangle', () => {
  it('lags a hand accelerating right (negative first), settles when left alone, never passes the clamp', () => {
    let s = { angle: 0, omega: 0 };
    s = dangle(s, 5000, 1 / 60, 60);
    expect(s.angle).toBeLessThan(0);
    let worst = 0;
    for (let i = 0; i < 20; i++) { s = dangle(s, 100000, 1 / 60, 60); worst = Math.max(worst, Math.abs(s.angle)); }
    expect(worst).toBeLessThanOrEqual(35);
    s = { angle: 25, omega: 0 };
    for (let i = 0; i < 180; i++) s = dangle(s, 0, 1 / 60, 60);
    expect(Math.abs(s.angle)).toBeLessThan(0.5);
  });
});

describe('pivotShift', () => {
  it.each([1, -1])('keeps the grab point fixed under rotation (flip %i)', (flip) => {
    const g = { x: 30, y: -40 }; // local grab point from the origin
    const q = { x: g.x * flip * 1.1, y: g.y * 0.95 }; // where scale(flip*sx, sy) puts it on screen
    for (const deg of [-35, -8, 12, 35]) {
      const t = pivotShift(q.x, q.y, deg);
      const r = (deg * Math.PI) / 180;
      expect(t.dx + Math.cos(r) * q.x - Math.sin(r) * q.y).toBeCloseTo(q.x, 6);
      expect(t.dy + Math.sin(r) * q.x + Math.cos(r) * q.y).toBeCloseTo(q.y, 6);
    }
  });
});

describe('landSquash', () => {
  it('dips more for harder impacts and returns to 1', () => {
    expect(landSquash(0, 200)).toBeGreaterThan(landSquash(0, 800));
    expect(landSquash(0, 800)).toBeGreaterThan(landSquash(0, 1400));
    expect(landSquash(0, 1400)).toBeGreaterThanOrEqual(0.75);
    expect(landSquash(220, 1400)).toBe(1);
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
  it('adds only a light footfall and no rock to a drawn side-on cycle', () => {
    expect(gait(10, 20, true).rot).toBe(0);
    expect(gait(30, 20, true).rot).toBe(0);
    expect(gait(10, 20, true).dy).toBeCloseTo(0.4 * bob(10, 20));
    expect(gait(10, 20, true).sy).toBeCloseTo(1.006);
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
  it('counts a new burst on each burst\'s first pop', () => {
    expect(woofBurst(0)).toBe(-1);
    expect(woofBurst(179)).toBe(-1);
    expect(woofBurst(180)).toBe(0);
    expect(woofBurst(520)).toBe(0); // second woof of the same burst
    expect(woofBurst(1400 + 180)).toBe(1);
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
