// The video's failing test for the pet to sniff; DEMO_FIXED=1 (demo/pass.command) is the fix.
// Kept at the top so it stays out of the source excerpt vitest prints under the failure.
import { expect, it } from 'vitest';
import { add } from './math';

it('adds', () => {
  expect(add(2, 2)).toBe(process.env['DEMO_FIXED'] === '1' ? 4 : 5);
});
