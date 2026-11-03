import { describe, expect, it } from 'vitest';
import { matchCommand } from './commands';

describe('matchCommand', () => {
  it('hears do a trick and zoomies; the last command still wins', () => {
    expect(matchCommand('Pakkun, do a trick', 'Pakkun')).toBe('trick');
    expect(matchCommand('pakkun trick!', 'Pakkun')).toBe('trick');
    expect(matchCommand('Pakkun zoomies', 'Pakkun')).toBe('zoomies');
    expect(matchCommand('pakkun, zoomie', 'Pakkun')).toBe('zoomies');
    expect(matchCommand('Pakkun sit, no, zoomies', 'Pakkun')).toBe('zoomies');
    expect(matchCommand('Pakkun zoomies then sit', 'Pakkun')).toBe('sit');
    expect(matchCommand('zoomies', 'Pakkun')).toBeNull();
  });
  it('a sentence that merely contains "trick" is not a command', () => {
    expect(matchCommand("what's the trick to rebasing", 'Pakkun', { requireName: false })).toBeNull();
    expect(matchCommand("that's a neat trick", 'Pakkun', { requireName: false })).toBeNull();
    expect(matchCommand('Pakkun, trick!', 'Pakkun')).toBe('trick');
  });
  it('requires the pet name', () => {
    expect(matchCommand('sit', 'Pakkun')).toBeNull();
  });
  it('matches commands case-insensitively', () => {
    expect(matchCommand('PAKKUN, sit!', 'Pakkun')).toBe('sit');
    expect(matchCommand('pakkun roll over', 'Pakkun')).toBe('roll');
    expect(matchCommand('Pakkun go to bed', 'Pakkun')).toBe('bed');
    expect(matchCommand('pakkun come here', 'Pakkun')).toBe('come');
  });
  it('returns null for unknown commands', () => {
    expect(matchCommand('pakkun dance', 'Pakkun')).toBeNull();
  });
});

describe('matchCommand hardening', () => {
  it('tolerates punctuation and filler', () => {
    expect(matchCommand('Pakkun, can you sit?', 'Pakkun')).toBe('sit');
    expect(matchCommand('hey pakkun... please go to bed.', 'Pakkun')).toBe('bed');
  });
  it('fuzzy-matches long names within edit distance 1', () => {
    expect(matchCommand('pakun sit', 'Pakkun')).toBe('sit');
    expect(matchCommand('paku sit', 'Pakkun')).toBeNull();
    expect(matchCommand('rex sit', 'Rexx')).toBeNull();
    expect(matchCommand('rx sit', 'Rexx')).toBeNull();
  });
  it('maps synonyms', () => {
    expect(matchCommand('Pakkun nap', 'Pakkun')).toBe('bed');
    expect(matchCommand('Pakkun speak', 'Pakkun')).toBe('bark');
    expect(matchCommand('Pakkun bark!', 'Pakkun')).toBe('bark');
  });
  it('returns the last command', () => {
    expect(matchCommand('Pakkun sit, no wait, roll over', 'Pakkun')).toBe('roll');
    expect(matchCommand('Pakkun come here and sit', 'Pakkun')).toBe('sit');
  });
});

describe('matchCommand without a required name', () => {
  it('matches bare commands only when asked to', () => {
    expect(matchCommand('can you roll over?', 'Pakkun', { requireName: false })).toBe('roll');
    expect(matchCommand('sit', 'Pakkun', { requireName: false })).toBe('sit');
    expect(matchCommand('hello there', 'Pakkun', { requireName: false })).toBeNull();
    expect(matchCommand('sit', 'Pakkun')).toBeNull();
  });
});
