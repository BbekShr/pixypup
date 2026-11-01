import { describe, expect, it } from 'vitest';
import { BIRTH_STEPS, copyFor, copyLines, nextCopy, ribbonFraction } from './birth';

describe('ribbon', () => {
  it('starts empty, grows with every arrival, and is only full once everything is in', () => {
    expect(ribbonFraction(false, 0)).toBe(0);
    let prev = 0;
    for (let p = 0; p < BIRTH_STEPS - 1; p++) {
      const f = ribbonFraction(true, p);
      expect(f).toBeGreaterThan(prev);
      expect(f).toBeLessThan(1);
      prev = f;
    }
    expect(ribbonFraction(true, BIRTH_STEPS - 1)).toBe(1);
  });
  it('stays in [0, 1] for out-of-range counts', () => {
    expect(ribbonFraction(true, 99)).toBe(1);
    expect(ribbonFraction(false, -3)).toBe(0);
  });
});

describe('copy rotation', () => {
  const lines = copyLines('Milo');
  it('speaks in the pet voice with the name', () => {
    expect(lines[0]).toContain("Milo's ears");
  });
  it('cycles the early lines and wraps', () => {
    const seen = [0, 1, 2, 3, 4].map((t) => copyFor(lines, t, 0.2));
    expect(seen.slice(0, 3)).toEqual(lines.slice(0, 3));
    expect(seen[3]).toBe(lines[0]);
    expect(seen).not.toContain(lines[3]);
  });
  it('holds "almost ready" only when the ribbon is nearly full', () => {
    expect(copyFor(lines, 0, 0.75)).toBe('Almost ready to say hi…');
    expect(copyFor(lines, 7, 0.5)).not.toBe('Almost ready to say hi…');
  });
});

describe('nextCopy with facts', () => {
  const lines = copyLines('Milo');
  const voice = ['Got snacks?'];
  const facts = [{ text: 'f0' }, { text: 'f1' }];
  it('alternates the pet voice with facts and cycles every fact', () => {
    const seq = [0, 1, 2, 3, 4, 5].map((t) => nextCopy(lines, voice, facts, t, 0.2));
    expect(seq.map((c) => c.fact)).toEqual([undefined, 0, undefined, 1, undefined, 0]);
    expect(seq[1]!.text).toBe('Did you know? f0');
  });
  it('without facts behaves like the plain rotation, and still holds the last line for the ribbon', () => {
    expect(nextCopy(lines, [], [], 1, 0.2).text).toBe(lines[1]);
    expect(nextCopy(lines, voice, facts, 1, 0.8)).toEqual({ text: 'Almost ready to say hi…' });
  });
});
