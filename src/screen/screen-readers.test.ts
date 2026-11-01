import { describe, expect, it } from 'vitest';
import { badgeBump, getBadges, parseBadges } from './dock-badge';
import type { Run } from './helper';
import { createScreenReader } from './reader';
import { clean, createTerminalReader, failureContext, findFailure, findPass, findRedLines, greenAfter, lineToScreen, overlap, parseVisible } from './terminal';
import { listWindows, parseWindows } from './window-list';
import { makeRun } from './helper';

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
  it('badgeBump: new or increased, not PixyPup, not unchanged', () => {
    expect(badgeBump({}, { Mail: '3' })).toEqual({ app: 'Mail', label: '3' });
    expect(badgeBump({ Mail: '3' }, { Mail: '3' })).toBeNull();
    expect(badgeBump({ Mail: '3' }, { Mail: '2' })).toBeNull();
    expect(badgeBump({ Mail: '3' }, { Mail: '4' })).toEqual({ app: 'Mail', label: '4' });
    expect(badgeBump({ Slack: '98' }, { Slack: '99+' })).toEqual({ app: 'Slack', label: '99+' });
    expect(badgeBump({}, { Slack: '•' })).toEqual({ app: 'Slack', label: '•' });
    expect(badgeBump({ Slack: '•' }, { Slack: '•' })).toBeNull();
    expect(badgeBump({ Mail: '3' }, {})).toBeNull();
    expect(badgeBump({}, { PixyPup: '1', pixypup: '2' })).toBeNull();
  });
  it('getBadges', async () => {
    expect(await getBadges(json({ badges: { Slack: '2' } }))).toEqual({ Slack: '2' });
    expect(await getBadges(json({ error: 'permission' }))).toBeNull();
  });
});

describe('findFailure', () => {
  const fails: Record<string, string[]> = {
    vitest: [' ✓ src/b.test.ts (2 tests)', ' FAIL  src/a.test.ts > adds numbers', ' Tests  1 failed | 2 passed (3)'],
    vitestVerbose: ['   × adds numbers 2ms'],
    jest: ['FAIL src/a.test.ts', '  ✕ adds (3 ms)', 'Tests:       1 failed, 2 passed, 3 total'],
    mocha: ['  2 passing (9ms)', '  1 failing'],
    pytest: ['FAILED tests/test_x.py::test_a - assert 1 == 2', '=== 1 failed, 3 passed in 0.1s ==='],
    tsc: ['src/a.ts(3,5): error TS2322: Type string is not assignable to type number.'],
    eslint: ['✖ 5 problems (2 errors, 3 warnings)'],
    node: ['AssertionError [ERR_ASSERTION]: expected 1 to be 2', 'TypeError: x is not a function'],
  };
  for (const [name, lines] of Object.entries(fails)) {
    it(`positive: ${name}`, () => {
      expect(findFailure(lines)).not.toBeNull();
      for (const l of lines) if (findFailure([l])) return;
      throw new Error('no line matched');
    });
  }
  const passes: Record<string, string> = {
    vitestPass: ' Tests  3 passed (3)',
    vitestCheck: ' ✓ handles Error case 2ms',
    zeroFailed: 'Tests  0 failed | 5 passed',
    zeroErrors: 'Found 0 errors. Watching for file changes.',
    eslintWarnings: '✖ 3 problems (0 errors, 3 warnings)',
    eslintWarnLine: '  3:5  warning  Unexpected any  @typescript-eslint/no-explicit-any',
    failover: 'failover ok',
    noErrors: 'no errors found',
    mochaPass: '  4 passing (12ms)',
    mathX: 'a × b = 6',
  };
  for (const [name, l] of Object.entries(passes)) {
    it(`negative: ${name}`, () => expect(findFailure([l])).toBeNull());
  }
  it('returns the LAST failing line', () => {
    expect(findFailure(['FAIL a', 'ok', 'FAIL b', 'done'])).toEqual({ lineIndex: 2, text: 'FAIL b' });
  });
  it('10 failed is a failure; 1 failed, 0 errors too', () => {
    expect(findFailure(['10 failed'])).not.toBeNull();
    expect(findFailure(['1 failed, 0 errors'])).not.toBeNull();
  });
});

describe('green runs', () => {
  const vitestFail = [' ❯ demo/math.test.ts (1 test | 1 failed) 4ms', ' FAIL  demo/math.test.ts > adds', 'AssertionError: expected 4 to be 5', ' Test Files  1 failed (1)', '      Tests  1 failed (1)'];
  const vitestPass = [' ✓ demo/math.test.ts (1 test) 2ms', ' Test Files  1 passed (1)', '      Tests  1 passed (1)', '   Duration  154ms'];
  it('finds the green summary of common runners', () => {
    for (const l of ['      Tests  4 passed (4)', 'Tests:       4 passed, 4 total', '==== 4 passed in 0.12s ====', '  4 passing (12ms)', ' PASS  src/a.test.js', 'Found 0 errors. Watching for file changes.']) {
      expect(findPass([l]), l).toBe(0);
    }
  });
  it('a summary that also failed, or a lone check mark, is not green', () => {
    for (const l of [' Tests  1 failed | 3 passed (4)', 'Tests: 1 failed, 3 passed, 4 total', ' ✓ src/b.test.ts (2 tests)', 'passed the salt']) expect(findPass([l]), l).toBeNull();
  });
  it('green only when the pass is the newest result on screen', () => {
    expect(greenAfter(vitestFail, findFailure(vitestFail)!.lineIndex)).toBe(false);
    expect(greenAfter(vitestPass, null)).toBe(true);
    const both = [...vitestFail, ...vitestPass];
    expect(greenAfter(both, findFailure(both)!.lineIndex)).toBe(true);
    const again = [...vitestPass, ...vitestFail];
    expect(greenAfter(again, findFailure(again)!.lineIndex)).toBe(false);
  });
  it('failure context starts at the first failing line and is capped', () => {
    expect(failureContext(vitestFail).split('\n')).toEqual(['❯ demo/math.test.ts (1 test | 1 failed) 4ms', 'FAIL  demo/math.test.ts > adds', 'AssertionError: expected 4 to be 5', 'Test Files  1 failed (1)', 'Tests  1 failed (1)']);
    expect(failureContext(['ok', 'fine'])).toBe('');
    const many = ['FAIL a', ...Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(200)}`)];
    expect(failureContext(many).startsWith('FAIL a\nline 0 ')).toBe(true);
    expect(Array.from(failureContext(many))).toHaveLength(1200);
    expect(failureContext(['FAIL a', ...Array.from({ length: 40 }, (_, i) => `l${i}`)]).split('\n')).toHaveLength(16);
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
  it('fromY skips the title-bar strip', () => {
    const w = 10, h = 10;
    const buf = new Uint8Array(w * h * 4);
    for (const y of [0, 1, 7]) for (let x = 0; x < 6; x++) buf[(y * w + x) * 4] = 255;
    expect(findRedLines(buf, w, h, 4, 3)).toEqual([{ x: 0, y: 7, w: 6, h: 1 }]);
    expect(findRedLines(buf, w, h, 4)).toHaveLength(2);
  });
  it('3-channel buffer, no red', () => {
    expect(findRedLines(new Uint8Array(5 * 5 * 3).fill(200), 5, 5, 3)).toEqual([]);
  });
});

// Default bounds equal win()'s CG bounds {x:100,y:50,w:800,h:628}.
const out = (rows: number, cols: number, tabs: number, id: number, text: string, b = '100\n50\n900\n678') =>
  `${rows}\n${cols}\n${tabs}\n${id}\n${b}\n${text}`;

describe('parseVisible / clean', () => {
  it('takes the tail that fits `rows`; trailing newlines dropped', () => {
    expect(parseVisible(out(2, 80, 1, 1, 'l1\nl2\nl3\n\n'))).toEqual({
      lines: ['l2', 'l3'], rowOf: [0, 1], rows: 2, tabs: 1, winId: 1, bounds: { x: 100, y: 50, w: 800, h: 628 },
    });
  });
  it('contents ending in ", 42" are not confused with metadata', () => {
    expect(parseVisible(out(5, 80, 1, 1, 'foo, 42'))?.lines).toEqual(['foo, 42']);
  });
  it('wrapped lines count at full height when picking the tail', () => {
    const long = 'x'.repeat(25); // 3 rows at 10 cols
    const v = parseVisible(out(5, 10, 1, 1, `a\n${long}\nb\nc`));
    // c(1) + b(1) + long(3) = 5 rows; a does not fit
    expect(v?.lines).toEqual([long, 'b', 'c']);
    expect(v?.rowOf).toEqual([0, 3, 4]);
  });
  it('rejects bad metadata', () => {
    expect(parseVisible(out(0, 80, 1, 1, 'a'))).toBeNull();
    expect(parseVisible(out(501, 80, 1, 1, 'a'))).toBeNull();
    expect(parseVisible(out(5, 0, 1, 1, 'a'))).toBeNull();
    expect(parseVisible(out(5, 80, 1, 1, 'a', '10\n10\n5\n20'))).toBeNull();
    expect(parseVisible(out(5, 80, 1, 1, 'a', 'a\n1\n2\n3'))).toBeNull();
    expect(parseVisible('x\nabc')).toBeNull();
    expect(parseVisible('no newline')).toBeNull();
  });
  it('strips control and bidi/zero-width chars, truncates by code points', () => {
    expect(clean('a\u0007b\u202Ec\u200Bd')).toBe('a bcd');
    const t = createTerminalReader();
    return t({
      run: json({}),
      osa: async () => out(5, 400, 1, 1, 'FAIL ' + '😀'.repeat(300)),
      windows: [win('Terminal')],
    }).then((r) => expect(Array.from(r.terminalError!.text)).toHaveLength(200));
  });
});

describe('terminal reader', () => {
  const screen = 'ok\nFAIL src/a.test.ts\nTests 1 failed\n';
  const mk = (owner: string, o: string | null, calls: string[][] = []) => ({
    run: json({}),
    osa: async (a: string[]) => { calls.push(a); return o; },
    windows: [win(owner), win('Safari', 5)],
  });
  const term = win('Terminal').bounds;
  it('reports a green rerun below an old failure as a pass, not an error', async () => {
    const r = await createTerminalReader()(mk('Terminal', out(8, 80, 1, 1, `${screen}Tests 2 passed (2)\n`)));
    expect(r.terminalError).toBeNull();
    expect(r.terminalPass).toBe(true);
    const f = await createTerminalReader()(mk('Terminal', out(8, 80, 1, 1, screen)));
    expect(f.terminalPass).toBe(false);
    expect(f.terminalError?.context).toBe('FAIL src/a.test.ts\nTests 1 failed');
  });
  it('maps the last failing line and flags change once', async () => {
    const read = createTerminalReader();
    const d = mk('Terminal', out(4, 80, 1, 1, screen));
    const a = await read(d);
    expect(a.terminalError?.text).toBe('Tests 1 failed');
    expect(a.terminalError?.box).toEqual(lineToScreen(term, 4, 2));
    expect(a.changed).toBe(true);
    expect((await read(d)).changed).toBe(false);
    expect((await read(mk('Terminal', out(4, 80, 1, 1, 'ok')))).changed).toBe(true);
  });
  it('keeps the key when the same error scrolls to another row', async () => {
    const read = createTerminalReader();
    const a = await read(mk('Terminal', out(6, 80, 1, 1, 'FAIL x\nb\n')));
    const b = await read(mk('Terminal', out(6, 80, 1, 1, 'a\nFAIL x\n')));
    expect(b.terminalError!.box.y).not.toBe(a.terminalError!.box.y);
    expect(b.key).toBe(a.key);
    expect(b.changed).toBe(false);
  });
  it('adds the tab bar when there are several tabs', async () => {
    const r = await createTerminalReader()(mk('Terminal', out(4, 80, 2, 1, screen)));
    expect(r.terminalError?.box).toEqual(lineToScreen(term, 4, 2, 53));
  });
  it('accounts for wrapped lines', async () => {
    const r = await createTerminalReader()(mk('Terminal', out(6, 10, 1, 1, `${'y'.repeat(25)}\nFAIL z`)));
    expect(r.terminalError?.box).toEqual(lineToScreen(term, 6, 3));
  });
  it('never runs osascript for an unsupported or non-frontmost terminal', async () => {
    const calls: string[][] = [];
    expect((await createTerminalReader()(mk('Warp', screen, calls))).terminalError).toBeNull();
    const behind = { ...mk('Terminal', screen, calls), windows: [win('Safari', 5), win('Terminal')] };
    expect((await createTerminalReader()(behind)).terminalError).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it('skips PixyPup own window when finding the front window', async () => {
    const d = { ...mk('Terminal', out(4, 80, 1, 1, screen)), windows: [win('PixyPup', 9), win('Terminal')] };
    expect((await createTerminalReader()(d)).terminalError).not.toBeNull();
  });
  it('different id but same bounds still sniffs', async () => {
    expect((await createTerminalReader()(mk('Terminal', out(4, 80, 1, 77, screen)))).terminalError).not.toBeNull();
  });
  it('different id and different window bounds gives null', async () => {
    const elsewhere = out(4, 80, 1, 77, screen, '1000\n50\n1800\n678');
    expect((await createTerminalReader()(mk('Terminal', elsewhere))).terminalError).toBeNull();
  });
  it('maps from the AppleScript bounds, not the CG bounds', async () => {
    const shifted = out(4, 80, 1, 1, screen, '102\n52\n902\n680'); // ~99% overlap
    const r = await createTerminalReader()(mk('Terminal', shifted));
    expect(r.terminalError?.box).toEqual(lineToScreen({ x: 102, y: 52, w: 800, h: 628 }, 4, 2));
  });
  it('uses the iTerm2 script and skips the id check', async () => {
    const calls: string[][] = [];
    const r = await createTerminalReader()(mk('iTerm2', out(4, 80, 1, 0, 'FAIL x'), calls));
    expect(calls[0][1]).toContain('iTerm2');
    expect(r.terminalError).not.toBeNull();
  });
  const redImg = (y0: number) => {
    const w = 16, h = 16;
    const buf = new Uint8Array(w * h * 4);
    for (let y = y0; y < y0 + 2; y++) for (let x = 0; x < 8; x++) buf[(y * w + x) * 4] = 255;
    return { data: buf, w, h, channels: 4 };
  };
  const withImg = (img: ReturnType<typeof redImg>) => ({
    ...mk('Terminal', out(4, 80, 1, 1, screen)),
    run: (async () => ({ code: 0, stdout: Buffer.from('png'), stderr: '' })) as Run,
    decodePng: async () => img,
  });
  // image 16 px over an 800 pt window: scale 0.02, so 1 px = 50 pt. Text line 2 is at y = 50+32+2*149 = 380.
  it('prefers a red box near the text-derived row', async () => {
    const r = await createTerminalReader()(withImg(redImg(6)));
    expect(r.terminalError?.box.y).toBeCloseTo(50 + 6 / 0.02);
  });
  it('ignores a red box far from the text row (e.g. a different detector hit)', async () => {
    const r = await createTerminalReader()(withImg(redImg(14)));
    expect(r.terminalError?.box).toEqual(lineToScreen(term, 4, 2));
  });
  it('ignores red pixels in the title bar (close button)', async () => {
    // the scan starts below the title bar (see fromY test); fallback either way
    const r = await createTerminalReader()(withImg(redImg(0)));
    expect(r.terminalError?.box).toEqual(lineToScreen(term, 4, 2));
  });
  it('osascript failure gives null', async () => {
    expect((await createTerminalReader()(mk('Terminal', null))).terminalError).toBeNull();
  });
});

describe('overlap', () => {
  it('is 1 for equal, 0 for disjoint, fractional otherwise', () => {
    const a = { x: 0, y: 0, w: 10, h: 10 };
    expect(overlap(a, a)).toBe(1);
    expect(overlap(a, { x: 20, y: 0, w: 10, h: 10 })).toBe(0);
    expect(overlap(a, { x: 5, y: 0, w: 10, h: 10 })).toBeCloseTo(0.5);
  });
});

describe('makeRun', () => {
  it('missing binary resolves with a non-zero code', async () => {
    expect((await makeRun('/nonexistent/pixyhelper')(['windows'])).code).not.toBe(0);
  });
});

describe('createScreenReader', () => {
  const mkRun = (windows: unknown[]): Run => async (args) => {
    const o = args[0] === 'windows' ? { windows, titlesRedacted: false } : { badges: { Slack: '1' } };
    return { code: 0, stdout: Buffer.from(JSON.stringify(o)), stderr: '' };
  };
  const osa = async () => out(10, 80, 1, 1, 'FAIL x');
  it('composes and reports change only when something relevant moved', async () => {
    let wins = [win('Terminal'), { ...win('Safari', 5), title: 'tab one' }];
    const rd = createScreenReader({ run: (a, o) => mkRun(wins)(a, o), osa });
    const a = await rd.tick();
    expect(a.observation.badge).toBeNull(); // first read only seeds
    expect(a.observation.terminalError?.text).toBe('FAIL x');
    expect(a.changed).toBe(true);
    expect((await rd.tick()).changed).toBe(false);
    wins = [win('Terminal'), { ...win('Safari', 5), title: 'tab two' }];
    expect((await rd.tick()).changed).toBe(false);
  });
  it('reports a badge bump once, relative to the previous tick', async () => {
    let badges: Record<string, string> = { Mail: '1' };
    const run: Run = async (args) => {
      const o = args[0] === 'windows' ? { windows: [], titlesRedacted: false } : { badges };
      return { code: 0, stdout: Buffer.from(JSON.stringify(o)), stderr: '' };
    };
    const rd = createScreenReader({ run, osa });
    await rd.tick();
    badges = { Mail: '2' };
    expect((await rd.tick()).observation.badge).toEqual({ app: 'Mail', label: '2' });
    expect((await rd.tick()).observation.badge).toBeNull();
  });
  it('leaves unrelated window titles out; keeps call windows', async () => {
    const wins = [win('Terminal'), { ...win('Safari', 5), title: 'secret doc' }, { ...win('zoom.us', 6), title: 'x' }];
    const a = await createScreenReader({ run: mkRun(wins), osa }).tick();
    expect(a.observation.windows.map((w) => w.owner).sort()).toEqual(['Terminal', 'zoom.us']);
  });
});
