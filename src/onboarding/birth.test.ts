import { describe, expect, it } from 'vitest';
import { BIRTH_STEPS, copyFor, copyLines, ribbonFraction } from './birth';

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
