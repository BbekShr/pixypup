import { describe, expect, it } from 'vitest';
import { getSlackBadge, parseBadges, slackBadge } from './dock-badge';
import type { Run } from './helper';
import { createScreenReader } from './reader';
import { clean, createTerminalReader, findFailure, findRedLines, lineToScreen, parseVisible } from './terminal';
import { listWindows, parseWindows } from './window-list';

const win = (owner: string, id = 1) => ({
  id, pid: 10, owner, title: 'demo', bounds: { x: 100, y: 50, w: 800, h: 628 },
});
const json = (o: unknown): Run => async () => ({ code: 0, stdout: Buffer.from(JSON.stringify(o)), stderr: '' });

describe('parseWindows', () => {
  it('keeps valid rows, drops malformed, reads redaction flag', () => {
    const r = parseWindows({
      windows: [
        win('Terminal'),
        { ...win('X'), id: '2' },
        { ...win('Y'), bounds: { x: 0, y: 0, w: 'a', h: 1 } },
        null,
      ],
      titlesRedacted: true,
    });
    expect(r.windows).toHaveLength(1);
    expect(r.titlesRedacted).toBe(true);
  });
  it('garbage gives empty', () => {
    expect(parseWindows('x')).toEqual({ windows: [], titlesRedacted: false });
  });
  it('listWindows survives failure and bad JSON', async () => {
    const fail: Run = async () => ({ code: -1, stdout: Buffer.alloc(0), stderr: '' });
    const bad: Run = async () => ({ code: 0, stdout: Buffer.from('nope'), stderr: '' });
    expect((await listWindows(fail)).windows).toEqual([]);
    expect((await listWindows(bad)).windows).toEqual([]);
  });
});

describe('badges', () => {
  it('parses permission, badges, garbage', () => {
    expect(parseBadges({ error: 'permission' })).toBe('permission');
    expect(parseBadges({ badges: { Slack: '3', X: 1 } })).toEqual({ Slack: '3' });
    expect(parseBadges({ badges: [] })).toBeNull();
    expect(parseBadges(null)).toBeNull();
  });
  it('slackBadge is case-insensitive and short only', () => {
    expect(slackBadge({ slack: '99+' })).toBe('99+');
    expect(slackBadge({ Slack: '•' })).toBe('•');
    expect(slackBadge({ Slack: 'Bob: lunch?' })).toBeNull();
    expect(slackBadge({ Mail: '3' })).toBeNull();
  });
  it('getSlackBadge', async () => {
    expect(await getSlackBadge(json({ badges: { Slack: '2' } }))).toBe('2');
    expect(await getSlackBadge(json({ error: 'permission' }))).toBeNull();
  });
});

describe('findFailure', () => {
  it.each([
    [' FAIL  src/a.test.ts > adds'],
    ['AssertionError: expected 1 to be 2'],
    ['FAILED tests/test_x.py::test_a - assert 1 == 2'],
    ['  ✗ adds numbers'],
    ['src/a.ts(3,5): error TS2322: Type string is not assignable'],
    ['Tests  2 failed | 5 passed (7)'],
    ['● adds › fails  Error: boom'],
  ])('positive: %s', (l) => expect(findFailure([l])?.lineIndex).toBe(0));
  it.each([['Tests  0 failed | 5 passed'], ['failover ok'], ['no errors found'], ['10 passed'], ['  ✓ adds']])(
    'negative: %s',
    (l) => expect(findFailure([l])).toBeNull(),
  );
  it('returns the LAST failing line', () => {
    expect(findFailure(['FAIL a', 'ok', 'FAIL b', 'done'])).toEqual({ lineIndex: 2, text: 'FAIL b' });
  });
  it('10 failed is a failure (not mistaken for 0 failed)', () => {
    expect(findFailure(['10 failed'])).not.toBeNull();
  });
});

describe('lineToScreen', () => {
  it('maps in points', () => {
    const b = { x: 100, y: 50, w: 800, h: 628 }; // (628-28-8)/37 = 16
    expect(lineToScreen(b, 37, 10)).toEqual({ x: 104, y: 50 + 28 + 4 + 160, w: 792, h: 16 });
  });
  it('is scale independent (all points)', () => {
    const a = lineToScreen({ x: 0, y: 0, w: 400, h: 300 }, 10, 3);
    expect(a.h).toBeCloseTo((300 - 36) / 10);
    expect(a.y).toBeCloseTo(32 + 3 * a.h);
  });
});

describe('findRedLines', () => {
  it('finds two red bands on a 4-channel buffer', () => {
    const w = 20, h = 30;
    const buf = new Uint8Array(w * h * 4).fill(30);
    const paint = (y: number, x0: number, x1: number) => {
      for (let x = x0; x <= x1; x++) {
        const i = (y * w + x) * 4;
        buf[i] = 230; buf[i + 1] = 20; buf[i + 2] = 20;
      }
    };
    for (const y of [3, 4]) paint(y, 2, 10);
    for (const y of [20, 21, 22]) paint(y, 5, 15);
    expect(findRedLines(buf, w, h, 4)).toEqual([
      { x: 2, y: 3, w: 9, h: 2 },
      { x: 5, y: 20, w: 11, h: 3 },
    ]);
  });
  it('3-channel buffer, no red', () => {
    expect(findRedLines(new Uint8Array(5 * 5 * 3).fill(200), 5, 5, 3)).toEqual([]);
  });
});

describe('parseVisible / clean', () => {
  it('takes the last `rows` lines and the row count after the last comma', () => {
    const v = parseVisible('a, b\nl1\nl2\nl3\n\n, 2\n');
    expect(v).toEqual({ lines: ['l2', 'l3'], rows: 2 });
  });
  it('rejects bad row count', () => expect(parseVisible('x, y')).toBeNull());
  it('truncates and strips control chars', () => {
    expect(clean('a\u001b[31mb' + 'x'.repeat(300))).toHaveLength(200);
    expect(clean('a\u0007b')).toBe('a b');
  });
});

describe('terminal reader', () => {
  const screen = 'ok\nFAIL src/a.test.ts\nTests 1 failed\n';
  const mk = (owner: string, out: string | null, calls: string[][] = []) => ({
    run: json({}),
    osa: async (a: string[]) => { calls.push(a); return out; },
    windows: [win('Safari', 5), win(owner)],
  });
  it('maps the last failing line and flags change once', async () => {
    const read = createTerminalReader();
    const d = mk('Terminal', `${screen}, 4`);
    const a = await read(d);
    expect(a.terminalError?.text).toBe('Tests 1 failed');
    expect(a.terminalError?.box).toEqual(lineToScreen(win('Terminal').bounds, 4, 2));
    expect(a.changed).toBe(true);
    expect((await read(d)).changed).toBe(false);
    expect((await read(mk('Terminal', 'ok, 4'))).changed).toBe(true);
  });
  it('never runs osascript when no supported terminal window exists', async () => {
    const calls: string[][] = [];
    const r = await createTerminalReader()({ ...mk('Warp', screen, calls) });
    expect(calls).toHaveLength(0);
    expect(r.terminalError).toBeNull();
  });
  it('uses the iTerm2 script', async () => {
    const calls: string[][] = [];
    await createTerminalReader()(mk('iTerm2', 'x, 4', calls));
    expect(calls[0][1]).toContain('iTerm2');
  });
  it('prefers the red-pixel box when capture decodes', async () => {
    const w = 16, h = 16;
    const buf = new Uint8Array(w * h * 4).fill(0);
    for (let y = 4; y < 6; y++) for (let x = 0; x < 8; x++) { const i = (y * w + x) * 4; buf[i] = 255; }
    const d = {
      ...mk('Terminal', `${screen}, 4`),
      run: (async () => ({ code: 0, stdout: Buffer.from('png'), stderr: '' })) as Run,
      decodePng: async () => ({ data: buf, w, h, channels: 4 }),
    };
    const r = await createTerminalReader()(d);
    // image 16 px wide over an 800 pt window: scale 0.02
    expect(r.terminalError?.box.y).toBeCloseTo(50 + 4 / 0.02);
  });
  it('osascript failure gives null', async () => {
    expect((await createTerminalReader()(mk('Terminal', null))).terminalError).toBeNull();
  });
});

describe('createScreenReader', () => {
  it('composes and reports change only when something moved', async () => {
    const run: Run = async (args) => {
      const o = args[0] === 'windows' ? { windows: [win('Terminal')], titlesRedacted: false } : { badges: { Slack: '1' } };
      return { code: 0, stdout: Buffer.from(JSON.stringify(o)), stderr: '' };
    };
    const rd = createScreenReader({ run, osa: async () => 'FAIL x, 10' });
    const a = await rd.tick();
    expect(a.observation.slackBadge).toBe('1');
    expect(a.observation.terminalError?.text).toBe('FAIL x');
    expect(a.changed).toBe(true);
    expect((await rd.tick()).changed).toBe(false);
  });
});
