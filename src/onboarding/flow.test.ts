import { describe, expect, it } from 'vitest';
import { advance, initialFlow, speciesIssue, type FlowEvent } from './flow';

const run = (needsKey: boolean, evs: FlowEvent[], fromMenu = false) => evs.reduce(advance, initialFlow(needsKey, fromMenu));

describe('onboarding flow', () => {
  it('walks welcome -> photo -> name -> making -> done when a key exists', () => {
    expect(run(false, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }]).step).toBe('making');
    expect(run(false, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }, { t: 'success' }]).step).toBe('done');
  });
  it('inserts the key step only when a key is needed', () => {
    expect(run(true, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }]).step).toBe('key');
    expect(run(true, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }, { t: 'key-saved' }]).step).toBe('making');
  });
  it('a key saved on the welcome makes a later Make my pet skip the key step', () => {
    const evs: FlowEvent[] = [{ t: 'start' }, { t: 'photo' }, { t: 'named' }];
    expect(evs.reduce(advance, { ...initialFlow(true, false), needsKey: false }).step).toBe('making');
  });
  it('the menu entry skips the welcome', () => {
    expect(initialFlow(false, true).step).toBe('photo');
  });
  it('a bad key loops back to the key step, and a second go works', () => {
    const f = run(true, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }, { t: 'key-saved' }, { t: 'fail', code: 'bad-key' }]);
    expect(f).toEqual({ step: 'key', needsKey: true, error: 'bad-key' });
    expect(advance(advance(f, { t: 'key-saved' }), { t: 'success' }).step).toBe('done');
  });
  it('a bad key forces the key step even if a stale env key skipped it', () => {
    expect(run(false, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }, { t: 'fail', code: 'bad-key' }])).toMatchObject({ step: 'key', needsKey: true });
  });
  it('no pet found returns to the photo step; other failures offer a retry', () => {
    const base: FlowEvent[] = [{ t: 'start' }, { t: 'photo' }, { t: 'named' }];
    expect(run(false, [...base, { t: 'fail', code: 'no-pet-found' }])).toMatchObject({ step: 'photo', error: 'no-pet-found' });
    const failed = run(false, [...base, { t: 'fail', code: 'network' }]);
    expect(failed).toMatchObject({ step: 'failed', error: 'network' });
    expect(advance(failed, { t: 'retry' }).step).toBe('making');
  });
  it('back works from name and key only, and stray events are ignored', () => {
    expect(run(true, [{ t: 'start' }, { t: 'photo' }, { t: 'named' }, { t: 'back' }, { t: 'back' }]).step).toBe('photo');
    expect(advance(initialFlow(false, false), { t: 'success' }).step).toBe('welcome');
    expect(advance(initialFlow(false, false), { t: 'fail', code: 'network' }).step).toBe('welcome');
  });
});

describe('speciesIssue', () => {
  it('accepts free text and explains the rest kindly', () => {
    for (const ok of ['dog', ' husky ', 'monarch butterfly']) expect(speciesIssue(ok)).toBeNull();
    for (const bad of ['', '   ', '<script>', 'x'.repeat(31)]) expect(speciesIssue(bad)).toMatch(/\S/);
  });
});
