import { describe, expect, it } from 'vitest';
import type { SpriteManifest } from '../../contracts/types';
import { addPet, checkPetName, takenSlug, MAX_PETS, nameFor, petList, pickWindow, rekeyWins, removePet, renamed, routeReaction, withName } from './pets';

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
    expect(addPet(['Pakkun'], 'pakkun')).toBeNull();
    expect(takenSlug(['Pakkun', 'milo'], 'MILO')).toBe(true);
    expect(takenSlug(['Pakkun'], 'rex')).toBe(false);
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

describe('rekeyWins (replace-mode keeps the primary window)', () => {
  it('moves the window of a renamed primary to the new slug, so primary() is not null', () => {
    const wins = new Map([['old', 'WIN']]);
    const moves = rekeyWins(wins, petList({ petName: 'new' }));
    expect(moves).toEqual([['old', 'new']]);
    for (const [from, to] of moves) { wins.set(to, wins.get(from)!); wins.delete(from); }
    expect(pickWindow(wins, petList({ petName: 'new' })[0])).toBe('WIN');
  });
  it('leaves matching windows alone and only renames the orphan', () => {
    const wins = new Map([['old', 'A'], ['b', 'B']]);
    expect(rekeyWins(wins, ['new', 'b'])).toEqual([['old', 'new']]);
    expect(rekeyWins(wins, ['old', 'b'])).toEqual([]);
  });
  it('does not guess when nothing is free', () => {
    expect(rekeyWins(new Map([['a', 1], ['b', 2]]), ['b'])).toEqual([]);
  });
});

describe('renaming a pet', () => {
  const milo = { pet: 'Milo', species: 'Dog', poses: {}, personality: { breed: 'x', coat: 'x', traits: ['a', 'b', 'c'], energy: 'normal', lines: ["Hi I'm Milo, let's be besties!", 'MILO wants snacks', 'Milomatic is not a name', 'No name here'] } } as unknown as SpriteManifest;

  it('takes 1 to 24 characters, trimmed, with no control characters', () => {
    expect(checkPetName('  Biscuit ')).toBe('Biscuit');
    expect(checkPetName('🐶 Bao')).toBe('🐶 Bao');
    expect(checkPetName('x'.repeat(24))).toBe('x'.repeat(24));
    for (const bad of ['', '   ', 'x'.repeat(25), 'a\nb', 'a\u0007', 'a\u007f', 42, null, undefined]) expect(checkPetName(bad)).toBeNull();
  });
  it('renames the pet and every line that says its old name as a whole word', () => {
    const m = renamed(milo, 'Biscuit');
    expect(m.pet).toBe('Biscuit');
    expect(m.personality!.lines).toEqual(["Hi I'm Biscuit, let's be besties!", 'Biscuit wants snacks', 'Milomatic is not a name', 'No name here']);
    expect(milo.pet).toBe('Milo'); // the loaded pack is never mutated
  });
  it('a name with regex characters or $ is used literally', () => {
    expect(renamed(milo, 'Mr. $&').personality!.lines[0]).toBe("Hi I'm Mr. $&, let's be besties!");
    expect(renamed({ ...milo, pet: 'K.9' }, 'Rex').personality!.lines[0]).toBe("Hi I'm Milo, let's be besties!");
  });
  it('no override, or the same name, leaves the manifest as it is', () => {
    expect(renamed(milo, undefined)).toBe(milo);
    expect(renamed(milo, 'Milo')).toBe(milo);
    expect(renamed({ ...milo, personality: undefined }, 'Rex')).toMatchObject({ pet: 'Rex' });
  });
  it('stores by lowercased slug, and a rename back to the original clears it', () => {
    const n = withName(undefined, 'Kuma', 'Bear', 'Kuma');
    expect(n).toEqual({ kuma: 'Bear' });
    expect(nameFor(n, 'KUMA')).toBe('Bear');
    for (const k of ['constructor', 'toString', '__proto__']) expect(nameFor(n, k)).toBeUndefined();
    expect(withName(n, 'Kuma', 'Kuma', 'Kuma')).toEqual({});
    expect(withName(n, 'milo', 'Biscuit', 'Milo')).toEqual({ kuma: 'Bear', milo: 'Biscuit' });
  });
});
