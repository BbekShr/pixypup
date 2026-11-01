import { describe, expect, it } from 'vitest';
import { energyParams } from '../main/prefs';
import { dwellMs, isClick, next, onTimeout, release, resolveWalk, sitHoldMs, type PetEvent, type PetState } from './state';

describe('next', () => {
  it('drag wins over everything and drop resumes walking', () => {
    expect(next('walk', 'dragStart')).toBe('drag');
    for (const e of ['idle', 'walk', 'sit', 'sleep', 'bark', 'roll', 'click'] as PetEvent[]) {
      expect(next('drag', e)).toBe('drag');
    }
    expect(next('drag', 'dragEnd')).toBe('walk');
  });
  it('direct events set the state', () => {
    expect(next('walk', 'idle')).toBe('idle');
    expect(next('idle', 'walk')).toBe('walk');
    expect(next('idle', 'sleep')).toBe('sleep');
  });
  it('clicks cycle sit -> bark -> roll -> sit', () => {
    let s: PetState = 'walk';
    const seen: PetState[] = [];
    for (let i = 0; i < 4; i++) seen.push((s = next(s, 'click')));
    expect(seen).toEqual(['sit', 'bark', 'roll', 'sit']);
    expect(next('idle', 'click')).toBe('sit');
  });
  it('a click wakes a sleeping pet with a bark', () => {
    expect(next('sleep', 'click')).toBe('bark');
  });
});

describe('wander schedule', () => {
  it('walk ends in idle, or sit 20% of the time', () => {
    expect(onTimeout('walk', 0.5, 0)).toBe('idle');
    expect(onTimeout('walk', 0.1, 0)).toBe('sit');
  });
  it('idle, sit and tricks go back to walking', () => {
    for (const s of ['idle', 'sit', 'bark', 'roll'] as PetState[]) expect(onTimeout(s, 0.5, 0)).toBe('walk');
  });
  it('falls asleep after 60 s without interaction and stays asleep', () => {
    expect(onTimeout('idle', 0.5, 60_000)).toBe('sleep');
    expect(onTimeout('idle', 0.5, 59_000)).toBe('walk');
    expect(onTimeout('sleep', 0.5, 0)).toBe('sleep');
  });
  it('dwell times', () => {
    expect(dwellMs('idle', 0)).toBe(3000);
    expect(dwellMs('idle', 1)).toBe(5000);
    expect(dwellMs('bark', 0.5)).toBe(2500);
    expect(dwellMs('sleep', 0.5)).toBeNull();
    expect(dwellMs('drag', 0.5)).toBeNull();
    expect(dwellMs('walk', 0.5)).toBeNull();
  });
});

describe('energy', () => {
  const sleepy = energyParams('sleepy');
  const playful = energyParams('playful');
  it('scales dwell times', () => {
    expect(dwellMs('idle', 0, sleepy)).toBeGreaterThan(dwellMs('idle', 0)!);
    expect(dwellMs('idle', 0, playful)).toBeLessThan(dwellMs('idle', 0)!);
    expect(dwellMs('bark', 0.5, playful)).toBe(2500 * playful.dwell);
    expect(dwellMs('sleep', 0.5, playful)).toBeNull();
  });
  it('sleep-after: sleepy 30 s, playful 3 min', () => {
    expect(onTimeout('idle', 0.5, 30_000, sleepy)).toBe('sleep');
    expect(onTimeout('idle', 0.5, 30_000, playful)).toBe('walk');
    expect(onTimeout('idle', 0.5, 179_000, playful)).toBe('walk');
    expect(onTimeout('idle', 0.5, 180_000, playful)).toBe('sleep');
  });
  it('playful barks sometimes, sleepy sits more after a walk, normal never does a spontaneous trick', () => {
    expect(onTimeout('idle', 0.1, 0, playful)).toBe('bark');
    expect(onTimeout('idle', 0.5, 0, playful)).toBe('walk');
    expect(onTimeout('idle', 0.01, 0)).toBe('walk');
    expect(onTimeout('walk', 0.3, 0, sleepy)).toBe('sit');
    expect(onTimeout('walk', 0.3, 0)).toBe('idle');
  });
});

describe('stay, click and release', () => {
  it('stay turns wander walks into idle but obeys an explicit target (come)', () => {
    expect(resolveWalk('walk', true, false)).toBe('idle');
    expect(resolveWalk('walk', true, true)).toBe('walk');
    expect(resolveWalk('walk', false, false)).toBe('walk');
    expect(resolveWalk('sit', true, false)).toBe('sit');
  });
  it('a click is a short, still press', () => {
    expect(isClick(4.9, 299)).toBe(true);
    expect(isClick(5, 100)).toBe(false);
    expect(isClick(1, 300)).toBe(false);
  });
  it('release honours stay for drops and clicks, and clicks keep the trick cycle', () => {
    expect(release('sit', true, false)).toBe('bark');
    expect(release('sleep', true, false)).toBe('bark');
    expect(release('walk', false, false)).toBe('walk');
    expect(release('walk', false, true)).toBe('idle');
    expect(release('walk', true, true)).toBe('sit');
  });
  it('a lost pointer (release as a non-click) never leaves the pet in drag', () => {
    for (const stay of [true, false]) expect(release('walk', false, stay)).not.toBe('drag');
  });
});

describe('commanded sit hold', () => {
  it('lasts about a minute, scaled by energy; stay holds without a timeout', () => {
    const [sleepy, normal, playful] = (['sleepy', 'normal', 'playful'] as const).map((e) => sitHoldMs(energyParams(e), false));
    expect(normal).toBe(60_000);
    expect(playful!).toBeLessThan(normal!);
    expect(sleepy!).toBeGreaterThan(normal!);
    expect(sitHoldMs(energyParams('normal'), true)).toBe(Infinity);
  });
  it('is far longer than the click-trick sit', () => {
    expect(sitHoldMs(energyParams('playful'), false)).toBeGreaterThan(10 * (dwellMs('sit', 0, energyParams('playful')) ?? 0));
  });
  it('a long sit nobody interrupted ends in a nap, a short one wanders on', () => {
    const p = energyParams('normal');
    expect(onTimeout('sit', 0.5, sitHoldMs(p, false), p)).toBe('sleep');
    expect(onTimeout('sit', 0.5, 5000, p)).toBe('walk');
  });
});
