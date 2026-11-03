import { describe, expect, it } from 'vitest';
import { actAfterCommand, holdsLongPose, actNeedsWalk, behaviorBusy, cornerSpot, CORNER_MARGIN, hideSpot, parseBehavior, parseHint, peekOutX, PEEK_PX, routeBehavior, sniffPose, talkPlan, toOverlayPoint, type Behavior } from './behavior';

const sniff: Behavior = { seq: 1, action: 'sniff', target: { x: 10, y: 10 }, reason: 'r' };
const free = { dragging: false, falling: false, resting: false, snoozed: false, handoff: null };

describe('parseBehavior', () => {
  it('accepts the three actions and caps the bubble', () => {
    expect(parseBehavior({ seq: 2, action: 'sniff', target: { x: 1, y: 2 }, bubble: ` ${'a'.repeat(60)} `, reason: 'x' })?.bubble).toHaveLength(40);
    expect(parseBehavior({ seq: 3, action: 'hide', on: true, reason: '' })).toMatchObject({ on: true });
    expect(parseBehavior({ seq: 4, action: 'perk_up', reason: '' })).not.toBeNull();
    expect(parseBehavior({ seq: 5, action: 'celebrate', bubble: 'You fixed it!', reason: '' })).toMatchObject({ action: 'celebrate', bubble: 'You fixed it!' });
  });
  it('a hint offer rides only on a sniff, and only as true', () => {
    expect(parseBehavior({ seq: 6, action: 'sniff', target: { x: 1, y: 2 }, hint: true, reason: '' })?.hint).toBe(true);
    expect(parseBehavior({ seq: 7, action: 'sniff', target: { x: 1, y: 2 }, hint: 'yes', reason: '' })?.hint).toBeUndefined();
    expect(parseBehavior({ seq: 8, action: 'perk_up', hint: true, reason: '' })?.hint).toBeUndefined();
  });
  it('a hint from main is a trimmed, capped string or nothing', () => {
    expect(parseHint('  look at add  ')).toBe('look at add');
    expect(parseHint('x'.repeat(300))).toHaveLength(200);
    for (const bad of [null, undefined, 5, '   ', { hint: 'x' }]) expect(parseHint(bad)).toBeNull();
  });
  it('rejects anything outside the fixed enum or malformed', () => {
    for (const bad of [null, 'x', {}, { seq: 1, action: 'walk_to', reason: '' }, { seq: NaN, action: 'perk_up' }, { seq: 1, action: 'sniff', reason: '' }, { seq: 1, action: 'hide', reason: '' }, { seq: 1, action: 'sniff', target: { x: 'a', y: 1 } }]) {
      expect(parseBehavior(bad)).toBeNull();
    }
  });
});

describe('behaviorBusy', () => {
  it('is free only when nothing owns the pet', () => {
    expect(behaviorBusy(free)).toBe(false);
    for (const k of ['dragging', 'falling', 'resting', 'snoozed'] as const) expect(behaviorBusy({ ...free, [k]: true })).toBe(true);
    for (const h of ['trotOff', 'drop', 'greet'] as const) expect(behaviorBusy({ ...free, handoff: h })).toBe(true);
    expect(behaviorBusy({ ...free, handoff: 'wander' })).toBe(false);
  });
});

describe('routeBehavior', () => {
  it('queues while busy and never interrupts a hand-off, drag or fall', () => {
    expect(routeBehavior(sniff, { busy: true, acting: null })).toBe('queue');
    expect(routeBehavior({ ...sniff, action: 'hide', on: true }, { busy: true, acting: null })).toBe('queue');
  });
  it('waits for a running behaviour and drops others while hidden', () => {
    expect(routeBehavior(sniff, { busy: false, acting: 'other' })).toBe('queue');
    expect(routeBehavior(sniff, { busy: false, acting: 'hide' })).toBe('drop');
    expect(routeBehavior({ ...sniff, action: 'hide', on: false }, { busy: false, acting: 'other' })).toBe('run');
    expect(routeBehavior(sniff, { busy: false, acting: null })).toBe('run');
  });
  it('a crisis talk replaces a running talk at once, but waits behind other acts', () => {
    const talk: Behavior = { seq: 9, action: 'talk', mood: 'comfort', reason: 'talk' };
    expect(routeBehavior({ ...talk, crisis: true }, { busy: false, acting: 'talk' })).toBe('run');
    expect(routeBehavior(talk, { busy: false, acting: 'talk' })).toBe('queue');
    expect(routeBehavior({ ...talk, crisis: true }, { busy: false, acting: 'other' })).toBe('queue');
  });
});

describe('hide geometry', () => {
  it('leaves exactly PEEK_PX visible at the nearer edge', () => {
    expect(hideSpot(100, 140, 1000)).toEqual({ side: -1, spot: PEEK_PX - 140 });
    expect(hideSpot(800, 140, 1000)).toEqual({ side: 1, spot: 1000 - PEEK_PX });
  });
  it('leans out further than the peek', () => {
    expect(peekOutX(-1, 140, 1000)).toBeGreaterThan(hideSpot(0, 140, 1000).spot);
    expect(peekOutX(1, 140, 1000)).toBeLessThan(hideSpot(900, 140, 1000).spot);
  });
});

describe('call modes', () => {
  it('parses hide mode, defaulting unknown values to hide', () => {
    expect(parseBehavior({ seq: 1, action: 'hide', on: true, mode: 'corner', reason: '' })?.mode).toBe('corner');
    expect(parseBehavior({ seq: 2, action: 'hide', on: true, mode: 'weird', reason: '' })?.mode).toBe('hide');
    expect(parseBehavior({ seq: 3, action: 'hide', on: true, reason: '' })?.mode).toBe('hide');
  });
  it('hides fully off-screen with a zero peek', () => {
    expect(hideSpot(100, 140, 1000, 0)).toEqual({ side: -1, spot: -140 });
    expect(hideSpot(800, 140, 1000, 0)).toEqual({ side: 1, spot: 1000 });
  });
  it('corner spot is fully inside the window at the nearer side', () => {
    expect(cornerSpot(100, 140, 1000)).toEqual({ side: -1, spot: CORNER_MARGIN });
    expect(cornerSpot(800, 140, 1000)).toEqual({ side: 1, spot: 1000 - 140 - CORNER_MARGIN });
    expect(cornerSpot(0, 140, 100).spot).toBeGreaterThanOrEqual(0);
  });
});

describe('sniffPose', () => {
  it('bobs three times and rests at the start and end', () => {
    expect(sniffPose(0).dy).toBeCloseTo(0);
    expect(sniffPose(1200).dy).toBeCloseTo(0);
    expect(sniffPose(200).dy).toBeLessThan(-2);
  });
});

describe('toOverlayPoint', () => {
  const b = { x: 0, y: 25, width: 1440, height: 875 };
  it('subtracts the overlay origin', () => expect(toOverlayPoint({ x: 500, y: 325 }, b)).toEqual({ x: 500, y: 300 }));
  it('clamps targets that are off the overlay', () => {
    expect(toOverlayPoint({ x: -50, y: 10 }, b)).toEqual({ x: 0, y: 0 });
    expect(toOverlayPoint({ x: 3000, y: 5000 }, b)).toEqual({ x: 1440, y: 875 });
    expect(toOverlayPoint({ x: 10, y: 10 }, { ...b, x: 1440 })).toEqual({ x: 0, y: 0 });
  });
});

describe('talk behavior', () => {
  it('parseBehavior needs a known mood and keeps crisis only when true', () => {
    expect(parseBehavior({ seq: 1, action: 'talk', mood: 'cheer', bubble: 'Woof woof!', reason: 'talk' })).toMatchObject({ action: 'talk', mood: 'cheer', bubble: 'Woof woof!' });
    expect(parseBehavior({ seq: 2, action: 'talk', mood: 'listen', crisis: true, reason: '' })?.crisis).toBe(true);
    expect(parseBehavior({ seq: 3, action: 'talk', mood: 'listen', crisis: 'yes', reason: '' })?.crisis).toBeUndefined();
    for (const mood of [undefined, 'dance', 5]) expect(parseBehavior({ seq: 4, action: 'talk', mood, reason: '' })).toBeNull();
  });
  it('talkPlan maps each mood to existing poses, and a crisis never celebrates', () => {
    expect(talkPlan('comfort', false)).toEqual({ walk: true, pose: 'sit', hearts: true });
    expect(talkPlan('cheer', false)).toEqual({ walk: false, pose: 'celebrate', hearts: true });
    expect(talkPlan('play', false)).toEqual({ walk: false, pose: 'roll', hearts: true });
    expect(talkPlan('nap', false)).toEqual({ walk: true, pose: 'sleep', hearts: false });
    expect(talkPlan('listen', false)).toEqual({ walk: true, pose: 'sit', hearts: false });
    for (const m of ['comfort', 'cheer', 'play', 'nap', 'listen'] as const) expect(talkPlan(m, true)).toEqual({ walk: true, pose: 'sit', hearts: false });
  });
});

describe('talk act wedge', () => {
  it('a user command yields a talk act but leaves other acts alone', () => {
    expect(actAfterCommand({ kind: 'talk' })).toBeNull();
    expect(actAfterCommand({ kind: 'sniff' })).toEqual({ kind: 'sniff' });
    expect(actAfterCommand(null)).toBeNull();
  });
  it('a user command also ends a zoom act, whose only exit is its walk', () => {
    expect(actAfterCommand({ kind: 'zoom' })).toBeNull();
  });
  it('actNeedsWalk is true only for walking phases of talk and zoom', () => {
    expect(actNeedsWalk({ kind: 'talk', phase: 'go' })).toBe(true);
    expect(actNeedsWalk({ kind: 'talk', phase: 'stay' })).toBe(false);
    expect(actNeedsWalk({ kind: 'zoom', phase: 'out' })).toBe(true);
    expect(actNeedsWalk({ kind: 'zoom', phase: 'back' })).toBe(true);
    expect(actNeedsWalk({ kind: 'zoom', phase: 'bark' })).toBe(false);
    expect(actNeedsWalk({ kind: 'hide', phase: 'go' })).toBe(false);
    expect(actNeedsWalk({ kind: 'perk' })).toBe(false);
    expect(actNeedsWalk(null)).toBe(false);
  });
});

describe('holdsLongPose', () => {
  it('is true only for a talk act in its stay phase', () => {
    expect(holdsLongPose({ kind: 'talk', phase: 'stay' })).toBe(true);
    expect([{ kind: 'talk', phase: 'go' }, { kind: 'zoom', phase: 'stay' }, { kind: 'sniff', phase: 'stay' }, null].map(holdsLongPose)).toEqual([false, false, false, false]);
  });
});
