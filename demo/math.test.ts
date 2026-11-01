import { expect, it } from 'vitest';
import { add } from './math';

// Fails on purpose: the video's "failing test" for Pakkun to sniff.
it('adds', () => {
  expect(add(2, 2)).toBe(5);
});
