import { describe, expect, it } from 'vitest';
import { ruleDecide, type Observation } from './decide';
import { getMedia, parseMedia } from './media';
import type { Run } from './helper';

const base: Observation = { windows: [], badge: null, terminalError: null };
const b = { x: 0, y: 0, w: 100, h: 50 };

describe('ruleDecide', () => {
  it('returns null when nothing is going on', () => {
    expect(ruleDecide(base)).toBeNull();
  });
  it('hides during Zoom', () => {
    const d = ruleDecide({ ...base, windows: [{ owner: 'zoom.us', title: 'Zoom Meeting', bounds: b }] });
    expect(d?.action).toBe('hide');
  });
  it('hides during Meet', () => {
    const d = ruleDecide({ ...base, windows: [{ owner: 'Chrome', title: 'Meet - pix-ypup-dem', bounds: b }] });
    expect(d?.action).toBe('hide');
  });
  it('hides for the web Zoom client and a meet.google.com title', () => {
    for (const title of ['Zoom Meeting', 'Zoom Meeting - Zoom', 'meet.google.com/abc-defg-hij']) {
      expect(ruleDecide({ ...base, windows: [{ owner: 'Safari', title, bounds: b }] })?.action).toBe('hide');
    }
  });
  it('does not hide for documents that merely mention Zoom', () => {
    for (const title of ['Zoom meeting notes', 'Zoom Meeting notes - Notion', 'Notes from the Meet - Q3']) {
      expect(ruleDecide({ ...base, windows: [{ owner: 'Notion', title, bounds: b }] })).toBeNull();
    }
  });
  it('hides for a named Meet (calendar event title)', () => {
    expect(ruleDecide({ ...base, windows: [{ owner: 'Google Chrome', title: 'Meet - Weekly Sync', bounds: b }] })?.action).toBe('hide');
  });
  it('hides for a Chrome Meet tab with a full title', () => {
    const d = ruleDecide({
      ...base,
      windows: [{ owner: 'Google Chrome', title: 'Meet - abc-defg-hij - Google Chrome', bounds: b }],
    });
    expect(d?.action).toBe('hide');
  });
  it('sniffs in a terminal whose title contains zoom', () => {
    const d = ruleDecide({
      ...base,
      windows: [{ owner: 'Terminal', title: '~/code/zoom-lens — npx vitest', bounds: b }],
      terminalError: { text: 'boom' },
    });
    expect(d?.action).toBe('sniff');
  });
  it('does not treat meeting notes as a call', () => {
    const d = ruleDecide({
      ...base,
      windows: [{ owner: 'Code', title: 'meeting notes.md', bounds: b }],
    });
    expect(d).toBeNull();
  });
  it('sniffs the error box center', () => {
    const d = ruleDecide({ ...base, terminalError: { text: 'boom', box: { x: 10, y: 20, w: 100, h: 40 } } });
    expect(d).toMatchObject({ action: 'sniff', target: { x: -6, y: 40 } });
  });
  it('sniffs window bottom-left without a box', () => {
    const d = ruleDecide({
      ...base,
      windows: [{ owner: 'Terminal', title: 'zsh', bounds: { x: 5, y: 10, w: 300, h: 200 } }],
      terminalError: { text: 'boom' },
    });
    expect(d?.target).toEqual({ x: 5, y: 210 });
  });
  it('perks up for a badge, naming the app (truncated)', () => {
    expect(ruleDecide({ ...base, badge: { app: 'Mail', label: '3' } })).toMatchObject({ action: 'perk_up', reason: 'new badge in Mail' });
    expect(ruleDecide({ ...base, badge: { app: 'x'.repeat(50), label: '1' } })?.reason).toBe(`new badge in ${'x'.repeat(30)}`);
  });
  it('sniff beats perk_up', () => {
    expect(ruleDecide({ ...base, badge: { app: 'Mail', label: '1' }, terminalError: { text: 'x' } })?.action).toBe('sniff');
  });
  it('call beats error', () => {
    const d = ruleDecide({
      windows: [{ owner: 'zoom.us', title: '', bounds: b }],
      badge: { app: 'Mail', label: '1' },
      terminalError: { text: 'x' },
    });
    expect(d?.action).toBe('hide');
  });

  const w = (owner: string, title: string) => ({ ...base, windows: [{ owner, title, bounds: b }] });
  const media = (camera: boolean, micApps: string[]) => ({ ...base, media: { camera, micApps } });
  const hides = (o: Observation) => ruleDecide(o)?.action === 'hide';

  it('hides for Meet with hyphen, en dash or em dash', () => {
    for (const t of ['Meet - abc-defg-hij', 'Meet \u2013 abc-defg-hij', 'Meet \u2014 abc-defg-hij']) expect(hides(w('Google Chrome', t))).toBe(true);
  });
  it('hides when Chrome holds the mic even if the Meet tab is in the background', () => {
    expect(hides({ ...w('Google Chrome', 'Inbox - Gmail'), ...media(false, ['com.google.Chrome.helper']) })).toBe(true);
  });
  it('hides when a camera is in use with no call titles', () => {
    expect(hides(media(true, []))).toBe(true);
  });
  it('Zoom home window does not hide, meeting and redacted title do', () => {
    for (const t of ['Zoom Workplace', 'Zoom', 'Settings', 'Zoom - Free Account']) expect(hides(w('zoom.us', t))).toBe(false);
    expect(hides(w('zoom.us', 'Zoom Meeting'))).toBe(true);
    expect(hides(w('zoom.us', 'Zoom Webinar'))).toBe(true);
    expect(hides(w('zoom.us', ''))).toBe(true);
  });
  it('Teams: mic, meeting title; chat without mic does not hide', () => {
    expect(hides(media(false, ['com.microsoft.teams2']))).toBe(true);
    expect(hides(w('Microsoft Teams', 'Meeting with Alice | Microsoft Teams'))).toBe(true);
    expect(hides(w('Google Chrome', 'Call with Bob | Microsoft Teams'))).toBe(true);
    expect(hides({ ...w('Microsoft Teams', 'Chat | Microsoft Teams'), ...media(false, []) })).toBe(false);
  });
  it('PixyPup/Electron mic and look-alike bundle ids never count', () => {
    expect(hides(media(false, ['dev.pixypup.app', 'dev.pixypup.app.helper', 'com.github.Electron', 'us.zoomer.app', 'com.google.Chromey']))).toBe(false);
  });
  it('null media falls back to titles', () => {
    expect(hides({ ...w('Google Chrome', 'Meet - abc'), media: null })).toBe(true);
    expect(ruleDecide({ ...base, media: null })).toBeNull();
  });
  it('reason carries no title or bundle id', () => {
    expect(ruleDecide(media(false, ['us.zoom.xos']))?.reason).toBe('video call in progress');
  });
});

describe('parseMedia / getMedia', () => {
  it('parses valid, drops bad entries, rejects garbage', () => {
    expect(parseMedia({ camera: true, micApps: ['a.b', 3, 'x'.repeat(500), 'has space'] })).toEqual({ camera: true, micApps: ['a.b'] });
    for (const g of [null, 'x', [], {}, { camera: 'yes', micApps: [] }, { camera: false, micApps: 'a' }, { badges: {} }]) expect(parseMedia(g)).toBeNull();
  });
  it('old helper (non-zero exit) is unknown', async () => {
    const fail: Run = async () => ({ code: 1, stdout: Buffer.alloc(0), stderr: '' });
    expect(await getMedia(fail)).toBeNull();
  });
});
