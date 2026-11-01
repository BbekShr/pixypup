import { describe, expect, it } from 'vitest';
import { panelRows, parseDebug, type DebugInfo } from './debug-panel';

const info: DebugInfo = { ts: 1, gate: 'on', terminal: { found: true, text: 'FAIL a.test.ts' }, slack: null, call: false, decision: { action: 'sniff', reason: 'r', bubble: 'Found a bug!', source: 'spark+rule' }, sparkMs: 1234 };

describe('parseDebug', () => {
  it('rejects junk and unknown gates, keeps valid messages', () => {
    for (const bad of [null, 'x', {}, { on: 'yes' }]) expect(parseDebug(bad)).toBeNull();
    expect(parseDebug({ on: true, info: { ...info, gate: 'weird' } })).toEqual({ on: true });
    expect(parseDebug({ on: false })).toEqual({ on: false });
  });
  it('cuts screen text to 80 chars and drops a malformed box', () => {
    const m = parseDebug({ on: true, info: { ...info, terminal: { found: true, text: 'y'.repeat(500), box: { x: 'a' } } } });
    expect(m?.info?.terminal.text).toHaveLength(80);
    expect(m?.info?.terminal.box).toBeUndefined();
  });
  it('rejects an unknown decision source', () => {
    expect(parseDebug({ on: true, info: { ...info, decision: { action: 'sniff', reason: '', source: 'evil' } } })?.info?.decision).toBeNull();
  });
});

describe('panelRows', () => {
  it('shows the decision, bubble and Spark latency', () => {
    const rows = panelRows(info);
    expect(rows).toContainEqual(['Decision', 'sniff · spark+rule']);
    expect(rows).toContainEqual(['Bubble', '“Found a bug!”']);
    expect(rows).toContainEqual(['', 'by Muse Spark in 1.2 s']);
    expect(rows).toContainEqual(['', 'FAIL a.test.ts', true]);
  });
  it('says why when it is not looking, and shows nothing from the screen', () => {
    expect(panelRows({ ...info, gate: 'admin' })).toEqual([['Notice my screen', 'off, set by your organisation']]);
    expect(panelRows(null)).toHaveLength(1);
  });
});
