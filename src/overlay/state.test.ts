import { describe, expect, it } from 'vitest';
import { dwellMs, next, onTimeout, type PetEvent, type PetState } from './state';

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
