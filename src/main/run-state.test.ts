import { describe, expect, it } from 'vitest';
import { finishRun, noRuns, record, startRun, type Progress } from './run-state';

const p = (name: string, url = name): Progress => ({ kind: name === 'cutout' ? 'cutout' : 'pose', name, url });

describe('run ownership', () => {
  it('refuses a second run while one is in flight, and leaves the first untouched', () => {
    const a = startRun(noRuns, 'Milo', 'cat')!;
    const r = record(a.runs, a.id, p('cutout'));
    expect(startRun(r, 'Other', 'dog')).toBeNull();
    expect(r.current?.name).toBe('Milo');
    expect(r.current?.progress).toHaveLength(1);
  });
  it('ignores progress and finish from a run that no longer owns the slot', () => {
    const a = startRun(noRuns, 'Milo', 'cat')!;
    const done = finishRun(a.runs, a.id);
    const b = startRun(done, 'Rex', 'dog')!;
    expect(b.id).not.toBe(a.id);
    expect(record(b.runs, a.id, p('sit'))).toBe(b.runs);
    expect(finishRun(b.runs, a.id)).toBe(b.runs);
    expect(finishRun(b.runs, b.id).current).toBeNull();
  });
  it('keeps the cutout and one frame per pose for replay', () => {
    const a = startRun(noRuns, 'Milo', 'cat')!;
    let r = record(a.runs, a.id, p('cutout'));
    r = record(r, a.id, p('sit', 'one'));
    r = record(r, a.id, p('walk_0'));
    r = record(r, a.id, p('sit', 'two'));
    expect(r.current?.progress.map((x) => x.name)).toEqual(['cutout', 'walk_0', 'sit']);
    expect(r.current?.progress.find((x) => x.name === 'sit')?.url).toBe('two');
  });
});
