import { describe, expect, it } from 'vitest';
import { MAX_SPEED, bob, fall, lean, petTransform, walkFrame, breathe, hop, pickTarget, rollAngle, squash, walkSpeed } from './motion';
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
