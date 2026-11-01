// Pure rules for the screen-aware behaviours. Everything here arrives from screen text via main, so it is validated.
import { handoffBusy, type Handoff } from './handoff';

export type Behavior = {
  seq: number;
  action: 'sniff' | 'perk_up' | 'hide';
  target?: { x: number; y: number }; // overlay coordinates
  bubble?: string;
  on?: boolean; // hide only: level-triggered
  reason: string;
};

const ACTIONS = ['sniff', 'perk_up', 'hide'];
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
  if (b.action === 'sniff' && !b.target) return null;
  if (b.action === 'hide' && b.on === undefined) return null;
  return b;
}

export const behaviorBusy = (o: { dragging: boolean; falling: boolean; resting: boolean; snoozed: boolean; handoff: Handoff | null }): boolean =>
  o.dragging || o.falling || o.resting || o.snoozed || handoffBusy(o.handoff) || o.handoff === 'greet';

/** Hiding wins over everything; while hidden or mid-behaviour, other behaviours wait (queue) or are dropped (hidden). */
export function routeBehavior(b: Behavior, o: { busy: boolean; acting: 'hide' | 'other' | null }): 'run' | 'queue' | 'drop' {
  if (b.action === 'hide') return o.busy ? 'queue' : 'run';
  if (o.acting === 'hide') return 'drop';
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
