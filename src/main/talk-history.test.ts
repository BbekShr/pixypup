import { describe, expect, it } from 'vitest';
import { nextHistory } from './talk-history';

const ok = { action: 'comfort', woof: 'Woof', caption: '*leans*', crisis: false } as const;

describe('nextHistory', () => {
  it('keeps normal turns', () => {
    expect(nextHistory([], 'rough day', ok).map((t) => t.text)[0]).toBe('rough day');
  });
  it('never keeps a crisis turn, local or model-flagged, so it cannot be sent later', () => {
    const h = nextHistory([], 'rough day', ok);
    expect(nextHistory(h, 'i want to hurt myself', { ...ok, crisis: true })).toBe(h);
  });
});
