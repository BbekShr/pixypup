// The video's failing test for the pet to sniff. The bug is in treats.ts, not here.
import { expect, it } from 'vitest';
import { treats } from './treats';

it('three walks earn a full day of treats', () => {
  expect(treats(3)).toBe(6);
});
