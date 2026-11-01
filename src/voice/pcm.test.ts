import { describe, expect, it } from 'vitest';
import { downsampleTo24k } from './pcm';

describe('downsampleTo24k', () => {
  it('48k -> 24k halves the length and averages pairs', () => {
    const out = downsampleTo24k(new Float32Array([0, 0.5, 0.5, 0.5, -1, -1]), 48000);
    expect(out.length).toBe(3);
    expect(out[0]).toBe(Math.round(0.25 * 32767));
    expect(out[2]).toBe(-32768);
  });
  it('44.1k -> 24k scales the length', () => {
    expect(downsampleTo24k(new Float32Array(4410), 44100).length).toBe(2400);
  });
  it('passes 24k through and clamps', () => {
    const out = downsampleTo24k(new Float32Array([2, -2, 0]), 24000);
    expect([...out]).toEqual([32767, -32768, 0]);
  });
  it('handles empty input', () => {
    expect(downsampleTo24k(new Float32Array(0), 48000).length).toBe(0);
  });
});
