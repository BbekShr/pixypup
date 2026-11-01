import { describe, expect, it } from 'vitest';
import { next } from './state';

describe('next', () => {
  it('drag pauses walking and drop resumes it', () => {
    expect(next('walk', 'dragStart')).toBe('idle');
    expect(next('idle', 'dragEnd')).toBe('walk');
  });
  it('idle and walk events set the state', () => {
    expect(next('walk', 'idle')).toBe('idle');
    expect(next('idle', 'walk')).toBe('walk');
  });
});
