import { describe, expect, it } from 'vitest';
import { addPet, MAX_PETS, petList, pickWindow, removePet, routeReaction } from './pets';

describe('pet list', () => {
  it('empty or missing pets means just the primary', () => {
    expect(petList({ petName: 'Pakkun' })).toEqual(['Pakkun']);
    expect(petList({ petName: 'Pakkun', pets: [] })).toEqual(['Pakkun']);
    expect(petList({ petName: 'a', pets: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  it('adds up to the cap, never twice', () => {
    let l = ['a'];
    for (const s of ['b', 'c', 'd']) l = addPet(l, s)!;
    expect(l).toHaveLength(MAX_PETS);
    expect(addPet(l, 'e')).toBeNull();
    expect(addPet(['a'], 'a')).toBeNull();
  });
  it('sends one home but never the last', () => {
    expect(removePet(['a', 'b'], 'a')).toEqual(['b']);
    expect(removePet(['a'], 'a')).toBeNull();
    expect(removePet(['a', 'b'], 'zzz')).toBeNull();
  });
});

describe('per-sender routing (click-through stays per window)', () => {
  const wins = new Map([['a', 'WIN-A'], ['b', 'WIN-B']]);
  it('a sender only ever reaches its own window', () => {
    expect(pickWindow(wins, 'b')).toBe('WIN-B');
    expect(pickWindow(wins, 'nobody')).toBeUndefined();
    expect(pickWindow(wins, undefined)).toBeUndefined();
  });
});

describe('routeReaction', () => {
  const slugs = ['p', 'q', 'r'];
  it('sniff and celebrate go to the primary, the others perk up', () => {
    for (const action of ['sniff', 'celebrate']) {
      const r = routeReaction(slugs, { seq: 3, action });
      expect(r[0]![1].action).toBe(action);
      expect(r.slice(1).map((x) => x[1].action)).toEqual(['perk_up', 'perk_up']);
    }
  });
  it('hiding for a call reaches every pet', () => {
    expect(routeReaction(slugs, { seq: 1, action: 'hide' }).map((x) => x[1].action)).toEqual(['hide', 'hide', 'hide']);
  });
});
