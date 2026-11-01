// Pure calm-and-control rules (no Electron): the menu, the dev hook and the overlay all go through these.
export const SIZES = { small: 110, medium: 140, large: 180 } as const;
export type Size = keyof typeof SIZES;
export const ENERGIES = ['sleepy', 'normal', 'playful'] as const;
export type Energy = (typeof ENERGIES)[number];

export const isSize = (v: unknown): v is Size => typeof v === 'string' && Object.hasOwn(SIZES, v);
export const isEnergy = (v: unknown): v is Energy => (ENERGIES as readonly unknown[]).includes(v);

/** What main pushes to the overlay on every change. energy is already resolved (choice, else the pet's own, else normal). */
export interface Prefs { size: Size; energy: Energy; snoozed: boolean }

export function parsePrefs(raw: unknown): Prefs | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { size, energy, snoozed } = raw as Record<string, unknown>;
  return isSize(size) && isEnergy(energy) && typeof snoozed === 'boolean' ? { size, energy, snoozed } : null;
}

export interface EnergyParams {
  dwell: number; // multiplies every timed state
  speed: number; // multiplies the walking speed
  sleepAfterMs: number;
  sitChance: number; // at the end of a walk
  trickChance: number; // at the end of an idle/sit: bark instead of walking on
}

const ENERGY: Record<Energy, EnergyParams> = {
  sleepy: { dwell: 1.6, speed: 0.6, sleepAfterMs: 30_000, sitChance: 0.4, trickChance: 0 },
  normal: { dwell: 1, speed: 1, sleepAfterMs: 60_000, sitChance: 0.2, trickChance: 0 },
  playful: { dwell: 0.6, speed: 1.4, sleepAfterMs: 180_000, sitChance: 0.15, trickChance: 0.15 },
};
export const energyParams = (e: Energy): EnergyParams => ENERGY[e];

/** Speed and stroke scale with the sprite so a small pet does not skate and a large one does not crawl. */
export const sizeScale = (size: Size): number => SIZES[size] / SIZES.medium;

const HOUR_MS = 3_600_000;

/** "Until tomorrow" = the next 8:00 local time (today's if it is still before 8). Local Date arithmetic keeps it DST-safe. */
export function snoozeUntil(kind: '1h' | 'tomorrow', now: Date): number {
  if (kind === '1h') return now.getTime() + HOUR_MS;
  const d = new Date(now);
  d.setHours(8, 0, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const isSnoozed = (until: number | null, now: number): boolean => until !== null && until > now;

/** A menu/tray/dev command that changes a setting -> the settings patch; null for anything else (tricks, quit). */
export function commandToPatch(cmd: string, now: Date): Record<string, unknown> | null {
  const [k, v] = cmd.split(':');
  switch (k) {
    case 'snooze': return v === '1h' || v === 'tomorrow' ? { snoozeUntil: snoozeUntil(v, now) } : null;
    case 'wake': return { snoozeUntil: null };
    case 'size': return isSize(v) ? { size: v } : null;
    case 'energy': return isEnergy(v) ? { energy: v } : null;
    case 'hide': return v === 'on' || v === 'off' ? { hideInShares: v === 'on' } : null;
    // 'yes' is the explainer's answer; the menu only ever sends on (which asks first) or off.
    case 'screen': return v === 'yes' || v === 'off' ? { screenAware: v === 'yes' } : null;
    case 'login': return v === 'on' || v === 'off' ? { openAtLogin: v === 'on' } : null;
    default: return null;
  }
}
