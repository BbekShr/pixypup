import { describe, expect, it } from 'vitest';
import { nextHistory, settleReply } from './talk-history';

const ok = { action: 'comfort', woof: 'Woof', caption: '*leans*', crisis: false } as const;

describe('nextHistory', () => {
  it('keeps normal turns', () => {
    expect(nextHistory([], 'rough day', ok).map((t) => t.text)[0]).toBe('rough day');
  });
  it('never keeps a crisis turn, local or model-flagged, so it cannot be sent later', () => {
    const h = nextHistory([], 'rough day', ok);
    expect(nextHistory(h, 'i want to hurt myself', { ...ok, crisis: true })).toBe(h);
  });
});

describe('settleReply', () => {
  it('a reply from a closed session leaves the new session history alone and does not act', () => {
    const oldWin = {}; const newWin = {};
    const fresh = settleReply(oldWin, newWin, [], 'old text', ok);
    expect(fresh).toEqual({ history: [], live: false });
    expect(settleReply(oldWin, null, [], 'x', ok).live).toBe(false);
  });
  it('a reply from the live session is recorded', () => {
    const w = {};
    const s = settleReply(w, w, [], 'hi', ok);
    expect(s.live).toBe(true);
    expect(s.history[0]?.text).toBe('hi');
  });
});
