import { describe, expect, it } from 'vitest';
import { BLINK_MS, boundGait, MAX_SPEED, SETTLE_MS, barkPose, woofBurst, blinkDelay, envelope, airStep, dangle, headX, landSquash, pivotShift, releaseVelocity, lean, overlap, petTransform, settle, walkFrame, walkSpans, legChange, breathe, hop, pickTarget, rollAngle, squash, walkStep, turnScale, steer, mirrorScale, mirrorProgress, hopTurn, gaitParams, profileScale, walkBody, type Mirror, TURN_FLOOR, turnFrame, TURN_FRONT, TURN_FRONT34, TURN_SIDE, WALK_ACCEL, LEAN_DEG, zoomLegs, ZOOM_SPEEDUP } from './motion';
import { energyParams } from '../main/prefs';
import { displayWidth, floorLift, footPoints, footOffset, type FootPoint } from './layout';

describe('layout', () => {
  it('puts the foot line at footY of the displayed height and keeps aspect', () => {
    expect(footOffset(140, 0.993)).toBeCloseTo(139.02);
    expect(displayWidth(212, 288)).toBeCloseTo(103.06, 1);
  });
});

describe('motion', () => {
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
  it('even timing: a near-duplicate step passes quickly and a big one holds longer, over the same cycle', () => {
    const spans = walkSpans([10, 1, 10, 10]); // frame 1 barely differs from frame 2
    expect(spans[0]).toBe(0);
    expect(spans.at(-1)).toBe(4);
    const share = spans.slice(1).map((v, i) => v - spans[i]!);
    expect(share[1]).toBeLessThan(share[0]!); // the near-duplicate is on screen for less
    expect(Math.min(...share) / Math.max(...share)).toBeGreaterThanOrEqual(0.5 / 1.6); // clamped: never a flash
    // 1.7 strides is still the near-duplicate frame 1 with equal timing; it is short now, so frame 2 is already showing
    expect(walkFrame(34, 4, 20)).toBe(1);
    expect(walkFrame(34, 4, 20, spans)).toBe(2);
    expect(walkFrame(80, 4, 20, spans)).toBe(0); // still wraps once per cycle
  });
  it('even timing falls back to equal shares when there is nothing to measure', () => {
    expect(walkSpans([0, 0, 0])).toEqual([0, 1, 2, 3]);
    expect(walkFrame(25, 2, 20, [0, 1])).toBe(walkFrame(25, 2, 20)); // a table of the wrong length is ignored
  });
  it('measures leg change in the bottom of the frame only, wrapping last to first', () => {
    const w = 2;
    const h = 10;
    const blank = new Array(w * h).fill(0);
    const legs = blank.map((_, i) => (i >= 8 * w ? 255 : 0)); // bottom rows filled
    const head = blank.map((_, i) => (i < 2 * w ? 255 : 0)); // top rows filled: not legs
    const c = legChange([blank, legs, head], w, h);
    expect(c[0]).toBeGreaterThan(0); // blank -> legs
    expect(c[2]).toBe(0); // head -> blank: no leg change
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

describe('dangle soft limit', () => {
  it('a fast 200 px / 150 ms hand move peaks short of the stop and turns around smoothly', () => {
    const dt = 1 / 60;
    let s = { angle: 0, omega: 0 }, x = 0, hv = 0, peak = 0, turned = false;
    for (let i = 0; i < 90; i++) {
      const u = Math.min(1, (i + 1) / 9);
      const nx = 200 * (3 * u * u - 2 * u ** 3);
      const v = hv + ((nx - x) / dt - hv) * 0.5; // the overlay's hand smoothing
      const ax = Math.max(-30000, Math.min(30000, (v - hv) / dt));
      x = nx;
      hv = v;
      const prev = s;
      s = dangle(s, ax, dt, 60);
      peak = Math.max(peak, Math.abs(s.angle));
      expect(Math.abs(s.angle)).toBeLessThan(35);
      if (prev.omega * s.omega < 0) turned = true; // omega passes through 0 instead of being zeroed
      if (Math.abs(prev.angle) > 10 && s.omega === 0) throw new Error('omega zeroed mid-swing');
    }
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThan(30);
    expect(turned).toBe(true);
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

describe('walkStep', () => {
  const walk = (px: number, vMax = MAX_SPEED) => {
    let v = 0, x = 0, t = 0, top = 0;
    while (px - x >= 1 && t < 60) {
      v = walkStep(v, px - x, vMax, 1 / 60);
      x += Math.min(v / 60, px - x);
      t += 1 / 60;
      top = Math.max(top, v);
    }
    return { t, v, x, top };
  };
  it('accelerates from rest to vMax in about vMax/A seconds, never jumping or exceeding it', () => {
    let v = 0;
    let t = 0;
    for (; v < MAX_SPEED && t < 5; t += 1 / 60) {
      const n = walkStep(v, 10000, MAX_SPEED, 1 / 60);
      expect(n - v).toBeLessThanOrEqual((WALK_ACCEL * MAX_SPEED) / MAX_SPEED / 60 + 8 + 1e-9);
      expect(n).toBeLessThanOrEqual(MAX_SPEED);
      v = n;
    }
    expect(t).toBeGreaterThan((MAX_SPEED / WALK_ACCEL) * 0.8);
    expect(t).toBeLessThan((MAX_SPEED / WALK_ACCEL) * 1.3);
  });
  it.each([50, 200, 600])('a %d px walk arrives in bounded time, without overshoot, slowly', (px) => {
    for (const vMax of [54, MAX_SPEED, 126]) {
      const r = walk(px, vMax);
      expect(r.x).toBeLessThanOrEqual(px);
      expect(px - r.x).toBeLessThan(1); // the overlay arrives within 1 px
      expect(r.t).toBeLessThan(px / vMax + 3);
      expect(r.v).toBeLessThan(30 * Math.max(1, vMax / MAX_SPEED)); // within a pixel of the target: a third of cruise or less
    }
  });
  it('a short walk never reaches vMax', () => {
    expect(walk(20).top).toBeLessThan(MAX_SPEED);
    expect(walk(600).top).toBe(MAX_SPEED);
  });
  it('still moves when almost there', () => {
    expect(walkStep(0, 0, MAX_SPEED, 1 / 60)).toBeGreaterThan(0);
  });
});

describe('turnScale', () => {
  it('goes from +1 to -1 monotonically, crossing the sign once and never a zero-width sliver', () => {
    const v = Array.from({ length: 101 }, (_, i) => turnScale(i * 3.8, 380));
    expect(v[0]).toBe(1);
    expect(v[100]).toBe(-1);
    v.forEach((a, i) => {
      expect(Math.abs(a)).toBeGreaterThanOrEqual(TURN_FLOOR);
      if (i) expect(a).toBeLessThanOrEqual(v[i - 1]!);
    });
    expect(v.filter((a, i) => i && Math.sign(a) !== Math.sign(v[i - 1]!)).length).toBe(1);
  });
});

describe('lean', () => {
  it('is LEAN_DEG at steady speed, more when speeding up, less or negative when braking, and clamped', () => {
    expect(lean(1, 1, 0)).toBe(LEAN_DEG);
    expect(lean(1, 0.3, 1)).toBeGreaterThan(0);
    expect(lean(1, 1, 1)).toBeGreaterThan(lean(1, 1, 0));
    expect(lean(1, 1, -0.86)).toBeLessThan(lean(1, 1, 0));
    expect(lean(1, 0.2, -0.86)).toBeLessThan(0);
    expect(lean(1, 1, 50)).toBe(4);
    expect(lean(-1, 1, 50)).toBe(-4);
    expect(lean(-1, 1, 0)).toBe(-LEAN_DEG);
  });
});

describe('display width', () => {
  it('follows the chosen height', () => {
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

describe('boundGait', () => {
  const H = 100;
  const stride = 20;
  const samples = Array.from({ length: 200 }, (_, i) => boundGait((i / 200) * stride, stride, H));
  it('leaves the ground by at least 0.05h once per stride and is grounded at each footfall', () => {
    expect(Math.max(...samples.map((s) => -s.dy))).toBeGreaterThanOrEqual(0.05 * H);
    expect(Math.max(...samples.map((s) => -s.dy))).toBeLessThanOrEqual(0.07 * H + 1e-9);
    expect(boundGait(0, stride, H).dy).toBeCloseTo(0);
    expect(boundGait(stride, stride, H).dy).toBeCloseTo(0);
    expect(boundGait(3 * stride, stride, H).dy).toBeCloseTo(0);
  });
  it('stretches mid-air, squashes on landing, keeps volume, and pitches forward at push-off', () => {
    expect(boundGait(10, stride, H).sy).toBeCloseTo(1.06);
    expect(boundGait(0, stride, H).sy).toBeCloseTo(0.92);
    for (const s of samples) expect(s.sx * s.sy).toBeCloseTo(1);
    const rot = samples.map((s) => s.rot);
    expect(Math.max(...rot)).toBeGreaterThan(3);
    expect(Math.max(...rot)).toBeLessThan(4.5);
  });
  it('does not bounce a body that has not moved', () => {
    const still = boundGait(7 * stride, stride, H); // stopped on a footfall: the same pose every frame, nothing airborne
    expect(Math.abs(still.dy)).toBeLessThan(1e-9);
    expect(Math.abs(still.rot)).toBeLessThan(1e-9);
    expect(boundGait(7 * stride, stride, H)).toEqual(still);
  });
});

describe('bark, settle', () => {
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

describe('mirror', () => {
  const D = 380;
  const settled: Mirror = { from: -1, to: 1, at: -Infinity };

  it('a full turn goes from -> to with one sign change', () => {
    const m = steer(settled, -1, 1000, D);
    const v = Array.from({ length: 39 }, (_, i) => mirrorScale(m, 1000 + i * 10, D));
    expect(v[0]).toBe(1);
    expect(v.filter((a, i) => i && Math.sign(a) !== Math.sign(v[i - 1]!))).toHaveLength(1);
    expect(mirrorScale(m, 1000 + D, D)).toBe(-1);
    expect(mirrorScale(m, 5000, D)).toBe(-1);
  });

  it('want === to is a no-op', () => {
    expect(steer(settled, 1, 50, D)).toBe(settled);
    const m = steer(settled, -1, 0, D);
    expect(steer(m, -1, 100, D)).toBe(m);
  });

  it('a reversal at any point does not jump, and ends at the original facing', () => {
    const step = Math.max(...Array.from({ length: 38 }, (_, i) => Math.abs(turnScale((i + 1) * 10, D) - turnScale(i * 10, D))));
    for (const e of [1, 40, 95, 150, 189, 191, 230, 300, 379]) {
      const t0 = 1000;
      const m = steer(settled, -1, t0, D);
      const before = mirrorScale(m, t0 + e - 1, D);
      const r = steer(m, 1, t0 + e, D);
      const after = mirrorScale(r, t0 + e, D);
      expect(Math.abs(after - before)).toBeLessThanOrEqual(step + 1e-9);
      expect(mirrorScale(r, t0 + e + D, D)).toBe(1);
    }
  });

  it('durMs 0 is instant', () => {
    const m = steer(settled, -1, 10, 0);
    expect(mirrorScale(m, 10, 0)).toBe(-1);
    expect(mirrorScale(steer(m, 1, 11, 0), 11, 0)).toBe(1);
  });
});

describe('hopTurn', () => {
  const us = Array.from({ length: 101 }, (_, i) => i / 100);

  it('is symmetric in u <-> 1-u', () => {
    for (const u of us) {
      const a = hopTurn(u, 8);
      const b = hopTurn(1 - u, 8);
      expect(a.dy).toBeCloseTo(b.dy, 9);
      expect(a.sx).toBeCloseTo(b.sx, 9);
      expect(a.sy).toBeCloseTo(b.sy, 9);
    }
  });

  it('has the feet down at both ends, the apex at 0.5, and no air at height 0', () => {
    expect(hopTurn(0, 8).dy).toBeCloseTo(0, 9);
    expect(hopTurn(1, 8).dy).toBeCloseTo(0, 9);
    expect(Math.min(...us.map((u) => hopTurn(u, 8).dy))).toBe(hopTurn(0.5, 8).dy);
    expect(hopTurn(0.5, 8).dy).toBeCloseTo(-8, 9);
    expect(us.every((u) => hopTurn(u, 0).dy === 0)).toBe(true);
    expect(hopTurn(0.075, 0).sy).toBeCloseTo(0.92, 9);
  });

  it('a reversal at any point does not jump the composed body', () => {
    const D = 300;
    const f = (m: Mirror, t: number) => hopTurn(mirrorProgress(m, t, D), 8);
    const base = steer({ from: -1, to: 1, at: -Infinity }, -1, 1000, D);
    let step = 0;
    for (let t = 1000; t < 1000 + D; t++) step = Math.max(step, Math.abs(f(base, t + 1).dy - f(base, t).dy), 8 * Math.abs(f(base, t + 1).sy - f(base, t).sy));
    for (const e of [1, 20, 45, 100, 149, 151, 200, 255, 299]) {
      const r = steer(base, 1, 1000 + e, D);
      expect(Math.abs(f(r, 1000 + e).dy - f(base, 1000 + e - 1).dy)).toBeLessThanOrEqual(step + 1e-9);
      expect(Math.abs(f(r, 1000 + e).sy - f(base, 1000 + e - 1).sy) * 8).toBeLessThanOrEqual(step + 1e-9);
    }
  });
});

describe('turnFrame', () => {
  it('goes side, front34, front at the apex, front34, side', () => {
    const seq = [0.05, 0.3, 0.5, 0.7, 0.95].map((u) => turnFrame(u).idx);
    expect(seq).toEqual([TURN_SIDE, TURN_FRONT34, TURN_FRONT, TURN_FRONT34, TURN_SIDE]);
  });
  it('is symmetric under u -> 1-u', () => {
    for (let u = 0; u <= 1; u += 0.01) expect(turnFrame(u).idx).toBe(turnFrame(1 - u).idx);
  });
  it('flips the mirror once, at the apex where the front is drawn', () => {
    let flips = 0;
    let prev = turnFrame(0);
    for (let u = 0.001; u <= 1; u += 0.001) {
      const f = turnFrame(u);
      if (f.mirrorFromFacing !== prev.mirrorFromFacing) { flips++; expect(f.idx).toBe(TURN_FRONT); }
      prev = f;
    }
    expect(flips).toBe(1);
  });
});

describe('walkBody', () => {
  const H = 140;
  const dy = (p: number, g = gaitParams('walk')): number => walkBody(p, H, g).dy;
  it('is lowest on the down phases and highest on the up phases', () => {
    for (const p of [1 / 8, 5 / 8]) expect(dy(p)).toBeCloseTo(0.012 * H, 6);
    for (const p of [3 / 8, 7 / 8]) expect(dy(p)).toBeCloseTo(-0.012 * H, 6);
    for (const p of [0, 2 / 8, 4 / 8, 6 / 8]) expect(Math.abs(dy(p))).toBeLessThan(1e-9);
  });
  it('repeats every half cycle and is continuous across the wrap', () => {
    for (let p = 0; p < 0.5; p += 0.01) {
      expect(walkBody(p, H).dy).toBeCloseTo(walkBody(p + 0.5, H).dy, 9);
      expect(walkBody(p, H).rot).toBeCloseTo(walkBody(p + 0.5, H).rot, 9);
    }
    expect(walkBody(0, H).dy).toBeCloseTo(walkBody(1 - 1e-9, H).dy, 6);
  });
  it('stays small: the frames already draw the legs', () => {
    for (let p = 0; p <= 1; p += 0.01) {
      const b = walkBody(p, H);
      expect(Math.abs(b.dy)).toBeLessThanOrEqual(0.012 * H + 1e-9);
      expect(Math.abs(b.rot)).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(b.sx * b.sy).toBeCloseTo(1, 9); // volume kept
      expect(b.sy).toBeGreaterThanOrEqual(0.98 - 1e-9);
    }
  });
  it('the spine rocks out of phase with the dip', () => {
    expect(walkBody(0, H).rot).toBeCloseTo(1.2, 6);
    expect(walkBody(1 / 8, H).rot).toBeCloseTo(0, 6);
    expect(walkBody(2 / 8, H).rot).toBeCloseTo(-1.2, 6);
  });
});

describe('gaits', () => {
  it('a trot reaches further, bounces more and floats at the pass phases; a sneak is low, slow and nose-down', () => {
    const [w, t, s] = [gaitParams('walk'), gaitParams('trot'), gaitParams('sniff')];
    expect(t.reach).toBe(1.3);
    expect(t.bounce).toBe(1.8);
    expect(t.speed).toBe(2);
    expect(walkBody(0.25, 140, t).dy).toBeLessThan(walkBody(0.25, 140, w).dy);
    expect(s.speed).toBe(0.6);
    expect(s.sy).toBe(0.95);
    expect(walkBody(0.3, 140, s).sy).toBeLessThan(walkBody(0.3, 140, w).sy);
    expect(walkBody(0.25, 140, s).rot).toBeLessThan(walkBody(0.25, 140, w).rot - 3.9);
    expect(s.bounce).toBe(0.5);
  });
  it('the default dog profile reproduces the constants; other profiles scale and clamp', () => {
    expect(profileScale({ bounce: 0.03, pitchDeg: 2 })).toEqual({ bounce: 1, pitch: 1 });
    expect(profileScale(undefined)).toEqual({ bounce: 1, pitch: 1 });
    expect(profileScale({ bounce: 0.15, pitchDeg: 40 })).toEqual({ bounce: 1.5, pitch: 1.5 });
    expect(profileScale({ bounce: 0, pitchDeg: 0 })).toEqual({ bounce: 0.3, pitch: 0 });
  });
});

describe('zoomies', () => {
  it('sprints to the edge farther from the pet, then back part of the way, always on screen', () => {
    expect(zoomLegs(100, 200, 1000).far).toBe(800);
    expect(zoomLegs(700, 200, 1000).far).toBe(0);
    for (const x of [0, 100, 400, 800]) {
      const { far, back } = zoomLegs(x, 200, 1000);
      expect(back).toBeGreaterThanOrEqual(Math.min(far, x));
      expect(back).toBeLessThanOrEqual(Math.max(far, x));
    }
    expect(zoomLegs(100, 200, 1000).back).toBeCloseTo(800 + (100 - 800) * 0.6);
  });
  it('a pet wider than the screen stays at 0', () => {
    expect(zoomLegs(0, 1200, 1000)).toEqual({ far: 0, back: 0 });
  });
  it('the zoom gait is clearly faster than a trot, even at playful energy', () => {
    expect(gaitParams('zoom').speed).toBe(ZOOM_SPEEDUP);
    const play = energyParams('playful').speed;
    expect(gaitParams('zoom').speed * play).toBeGreaterThan(gaitParams('trot').speed * play * 1.4);
  });
});

describe('floorLift', () => {
  const H = 140, FW = 100, FOOT = 0.99;
  const pts: FootPoint[] = [[-0.4, 0], [-0.1, -0.03], [0.1, -0.02], [0.4, -0.008]]; // paws at different heights, as in a real silhouette
  // The browser's math: translate(O) * the petTransform string * translate(-O), applied to a point of the frame box.
  const paint = (t: string, [u, v]: FootPoint): number => {
    const n = (re: RegExp): number[] => t.match(re)!.slice(1).map(Number);
    const [, ty] = n(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/);
    const [deg] = n(/rotate\(([-\d.e]+)deg\)/);
    const [sx, sy] = n(/scale\(([-\d.e]+), ([-\d.e]+)\)/);
    const a = (deg! * Math.PI) / 180;
    return ty! + Math.sin(a) * u * FW * sx! + Math.cos(a) * v * H * sy!;
  };
  const lowest = (rot: number, flip: number, sx: number, sy: number, dy: number): number => {
    const lift = floorLift(pts, FW, H, sx * flip, sy, rot, dy);
    const t = petTransform(0, dy - lift, rot, flip, sx, sy);
    return Math.max(...pts.map((p) => paint(t, p))) - Math.max(...pts.map((p) => p[1] * H)); // 0 = where the level pet rests
  };
  it('a tilted sit keeps the lowest paw on the rest line, both tilts and both facings', () => {
    for (const rot of [-4, -3, -1, 0, 1, 3, 4]) for (const flip of [1, -1]) {
      const g = lowest(rot, flip, 1, 1.02, 0);
      expect(g).toBeLessThanOrEqual(1e-9);
      expect(g).toBeGreaterThanOrEqual(-0.5);
    }
  });
  it('walk and zoomies never put a paw below the line, with lean, stretch, flip and the bob', () => {
    for (const kind of ['walk', 'trot', 'zoom'] as const) for (const flip of [1, -1]) for (let p = 0; p < 1; p += 0.02) {
      const b = walkBody(p, H, gaitParams(kind));
      const rot = lean(flip, 1, 0) - b.rot * flip;
      expect(lowest(rot, flip, b.sx, b.sy, b.dy)).toBeLessThanOrEqual(1e-9);
    }
  });
  it('an unlifted bob does sink below the line, so the lift is what keeps it up', () => {
    const b = walkBody(1 / 8, H, gaitParams('zoom'));
    expect(b.dy).toBeGreaterThan(1);
    expect(floorLift(pts, FW, H, 1, b.sy, 0, b.dy)).toBeGreaterThan(1);
  });
});

describe('footPoints', () => {
  it('takes the lowest opaque pixel of each column bin, relative to the footY line', () => {
    const w = 10, h = 10;
    const a = new Uint8Array(w * h * 4);
    for (const [x, y] of [[2, 9], [7, 8], [0, 3]] as const) a[(y * w + x) * 4] = 255;
    const p = footPoints(a, w, h, 1, 10);
    expect(p).toHaveLength(3);
    expect(p[1]![0]).toBeCloseTo(-0.25);
    expect(p[1]![1]).toBeCloseTo(0);
    expect(p[2]![1]).toBeCloseTo(-0.1);
    expect(p[0]![1]).toBeCloseTo(-0.6);
  });
});
