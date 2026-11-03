// Pure rules for the screen-aware behaviours. Everything here arrives from screen text via main, so it is validated.
import { TALK_ACTIONS, type TalkAction } from '../api/pet-talk';
import { handoffBusy, type Handoff } from './handoff';

export type Behavior = {
  seq: number;
  action: 'sniff' | 'perk_up' | 'hide' | 'celebrate' | 'talk';
  target?: { x: number; y: number }; // overlay coordinates
  bubble?: string;
  on?: boolean; // hide only: level-triggered
  hint?: boolean; // sniff only: a fix hint can be asked for by clicking the pet
  mood?: TalkAction; // talk only
  crisis?: boolean; // talk only: the help card is up, so no cheering
  reason: string;
};

const ACTIONS = ['sniff', 'perk_up', 'hide', 'celebrate', 'talk'];
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseBehavior(raw: unknown): Behavior | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!num(r['seq']) || typeof r['action'] !== 'string' || !ACTIONS.includes(r['action'])) return null;
  const b: Behavior = { seq: r['seq'], action: r['action'] as Behavior['action'], reason: typeof r['reason'] === 'string' ? r['reason'].slice(0, 80) : '' };
  const t = r['target'] as Record<string, unknown> | undefined;
  if (t && num(t['x']) && num(t['y'])) b.target = { x: t['x'], y: t['y'] };
  if (typeof r['bubble'] === 'string' && r['bubble'].trim()) b.bubble = r['bubble'].trim().slice(0, 40);
  if (typeof r['on'] === 'boolean') b.on = r['on'];
  if (r['hint'] === true && b.action === 'sniff') b.hint = true;
  if (b.action === 'talk') {
    if (!(TALK_ACTIONS as readonly unknown[]).includes(r['mood'])) return null;
    b.mood = r['mood'] as TalkAction;
    if (r['crisis'] === true) b.crisis = true;
  }
  if (b.action === 'sniff' && !b.target) return null;
  if (b.action === 'hide' && b.on === undefined) return null;
  return b;
}

/** What main answered to "what's wrong, buddy?": model text, shown with textContent only. */
export function parseHint(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 200) : null;
}

/** How long after a sniff a click asks for a hint instead of doing a trick. */
export const HINT_WINDOW_MS = 120_000;

export const behaviorBusy = (o: { dragging: boolean; falling: boolean; resting: boolean; snoozed: boolean; handoff: Handoff | null }): boolean =>
  o.dragging || o.falling || o.resting || o.snoozed || handoffBusy(o.handoff) || o.handoff === 'greet';

/** Hiding wins over everything; while hidden or mid-behaviour, other behaviours wait (queue) or are dropped (hidden). */
export function routeBehavior(b: Behavior, o: { busy: boolean; acting: 'hide' | 'talk' | 'other' | null }): 'run' | 'queue' | 'drop' {
  if (b.action === 'hide') return o.busy ? 'queue' : 'run';
  if (o.acting === 'hide') return 'drop';
  if (b.action === 'talk' && b.crisis && o.acting === 'talk') return o.busy ? 'queue' : 'run'; // a crisis does not wait behind a chat act
  return o.busy || o.acting ? 'queue' : 'run';
}

export const PEEK_PX = 15;

/** x (left edge) that leaves only PEEK_PX of the sprite on screen, at the nearer edge; side -1 = left. */
export function hideSpot(x: number, w: number, screenW: number): { side: -1 | 1; spot: number } {
  const side = x + w / 2 < screenW / 2 ? -1 : 1;
  return { side, spot: side < 0 ? PEEK_PX - w : screenW - PEEK_PX };
}

/** Where the pet leans out when the call ends: well past the peek, still half hidden. */
export const peekOutX = (side: -1 | 1, w: number, screenW: number): number => (side < 0 ? -w * 0.5 : screenW - w * 0.5);

/** Nose-down sniff: forward tilt with three bobs over SNIFF_MS. `tilt` is in the direction of facing. */
export const SNIFF_MS = 1200;
export function sniffPose(ageMs: number): { tilt: number; dy: number } {
  const u = Math.min(1, Math.max(0, ageMs / SNIFF_MS));
  return { tilt: 9, dy: -3 * Math.abs(Math.sin(3 * Math.PI * u)) };
}

/** Global screen point -> overlay coordinates, clamped onto the overlay (a target on another display lands at its edge). */
export function toOverlayPoint(p: { x: number; y: number }, bounds: { x: number; y: number; width: number; height: number }): { x: number; y: number } {
  const c = (v: number, max: number): number => Math.min(max, Math.max(0, v));
  return { x: c(p.x - bounds.x, bounds.width), y: c(p.y - bounds.y, bounds.height) };
}

export interface TalkPlan { walk: boolean; pose: 'sit' | 'sleep' | 'roll' | 'celebrate'; hearts: boolean }

/** What the pet does for a chat reply, from the existing poses only. A crisis is never met with a party. */
export function talkPlan(mood: TalkAction, crisis: boolean): TalkPlan {
  if (crisis) return { walk: true, pose: 'sit', hearts: false };
  switch (mood) {
    case 'comfort': return { walk: true, pose: 'sit', hearts: true };
    case 'cheer': return { walk: false, pose: 'celebrate', hearts: true };
    case 'play': return { walk: false, pose: 'roll', hearts: true };
    case 'nap': return { walk: true, pose: 'sleep', hearts: false };
    case 'listen': return { walk: true, pose: 'sit', hearts: false };
  }
}

/** A user command replaces a talk or zoom act (its walk/pose); every other act is handled by its own rules. */
/** A talk act in its stay phase holds a LONG sit/sleep/roll pose that only the act's own timer ends. */
export const holdsLongPose = (act: { kind: string; phase?: string } | null): boolean => act?.kind === 'talk' && act.phase === 'stay';

export const actAfterCommand = <A extends { kind: string }>(act: A | null): A | null => (act?.kind === 'talk' || act?.kind === 'zoom' ? null : act);

/** Acts whose only exit is the walk they started: if the pet leaves 'walk' (poke, drag, snooze) the act must be dropped. */
export const actNeedsWalk = (a: { kind: string; phase?: string } | null): boolean =>
  (a?.kind === 'talk' && a.phase === 'go') || (a?.kind === 'zoom' && (a.phase === 'out' || a.phase === 'back'));
