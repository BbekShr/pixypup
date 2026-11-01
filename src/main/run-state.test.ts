import { describe, expect, it } from 'vitest';
import { factViews, finishRun, noRuns, record, recordInfo, sourceFor, startRun, type Progress } from './run-state';

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

describe('personality and facts', () => {
  const facts = [{ text: 'a', source: 'https://x.org/a' }, { text: 'b', source: 'http://x.org/b' }, { text: 'c' }, { text: 'd', source: 'https://x.org/d' }];
  const run = () => {
    const a = startRun(noRuns, 'Milo', 'dog')!;
    return { id: a.id, r: recordInfo(a.runs, a.id, { facts }) };
  };
  it('keeps at most three facts and ignores other runs', () => {
    const { id, r } = run();
    expect(r.current?.facts).toHaveLength(3);
    expect(recordInfo(r, id + 1, { facts: [] })).toBe(r);
  });
  it('opens only https sources of received facts, by index', () => {
    const { r } = run();
    expect(sourceFor(r, 0)).toBe('https://x.org/a');
    for (const bad of [1, 2, 3, -1, 1.5, '0', 'https://evil.example', undefined]) expect(sourceFor(r, bad)).toBeNull();
    expect(sourceFor(noRuns, 0)).toBeNull();
  });
  it('shows the page no URLs', () => {
    expect(JSON.stringify(factViews(facts))).not.toContain('http');
    expect(factViews(facts).map((f) => f.hasSource)).toEqual([true, false, false, true]);
  });
});
