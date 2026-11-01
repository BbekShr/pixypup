import { app } from 'electron';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isEnergy, isSize, type Energy, type Size } from './prefs';

export interface Settings {
  screenAware: boolean;
  voice: boolean;
  offline: boolean;
  adminDisableScreenAware: boolean;
  petName: string;
  onboarded: boolean;
  size: Size;
  energy?: Energy; // only an explicit choice is stored; absent = the pet's own personality.energy
  hideInShares: boolean;
  openAtLogin: boolean;
  snoozeUntil: number | null; // epoch ms
}

export const DEFAULT_SETTINGS: Settings = {
  screenAware: false,
  voice: false,
  offline: false, // admin restriction only: an admin sets true to block all background network (screen, voice)
  adminDisableScreenAware: false,
  petName: 'Pakkun',
  onboarded: false,
  size: 'medium',
  hideInShares: false,
  openAtLogin: false,
  snoozeUntil: null,
};

export const ADMIN_FILE = '/Library/Application Support/PixyPup/admin.json';

// An admin may only restrict: everything else (pet name, size, energy, snooze, login item) stays the user's.
const ADMIN_KEYS = ['screenAware', 'voice', 'offline', 'adminDisableScreenAware'] as const;

export function mergeSettings(
  defaults: Settings,
  user: Partial<Settings> = {},
  admin: Partial<Settings> = {},
): Settings {
  const merged: Settings = { ...defaults, ...user };
  for (const k of ADMIN_KEYS) {
    const v = admin[k];
    if (v !== undefined) merged[k] = v;
  }
  if (admin.hideInShares === true) merged.hideInShares = true;
  if (merged.adminDisableScreenAware) merged.screenAware = false;
  return merged;
}

const BOOLEAN_KEYS = ['screenAware', 'voice', 'offline', 'adminDisableScreenAware', 'onboarded', 'hideInShares', 'openAtLogin'] as const;

// null = file missing. Wrong-typed or unknown keys are dropped so e.g. "false" can't read as truthy.
export function parseSettingsFile(text: string | null | Error): {
  values: Partial<Settings>;
  failed: boolean;
  invalid: string[];
} {
  if (text === null) return { values: {}, failed: false, invalid: [] };
  if (text instanceof Error) return { values: {}, failed: true, invalid: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { values: {}, failed: true, invalid: [] };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { values: {}, failed: true, invalid: [] };
  }
  const obj = raw as Record<string, unknown>;
  const values: Partial<Settings> = {};
  const invalid: string[] = [];
  for (const k of BOOLEAN_KEYS) {
    if (!(k in obj)) continue;
    if (typeof obj[k] === 'boolean') values[k] = obj[k];
    else invalid.push(k);
  }
  if ('petName' in obj) {
    const name = obj.petName;
    if (typeof name === 'string' && name.length > 0 && name.length <= 40) values.petName = name;
    else invalid.push('petName');
  }
  if ('size' in obj) {
    if (isSize(obj.size)) values.size = obj.size;
    else invalid.push('size');
  }
  if ('energy' in obj) {
    if (isEnergy(obj.energy)) values.energy = obj.energy;
    else invalid.push('energy');
  }
  if ('snoozeUntil' in obj) {
    const t = obj.snoozeUntil;
    if (t === null || (typeof t === 'number' && Number.isFinite(t) && t >= 0)) values.snoozeUntil = t;
    else invalid.push('snoozeUntil');
  }
  return { values, failed: false, invalid };
}

function readFile(path: string): string | null | Error {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    // existsSync would report EACCES as missing; only ENOENT means no policy file.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return e instanceof Error ? e : new Error('read failed');
  }
}

function loadAdmin(): ReturnType<typeof parseSettingsFile> {
  const admin = parseSettingsFile(readFile(ADMIN_FILE));
  if (admin.failed || admin.invalid.length > 0) {
    console.warn('PixyPup: admin.json unreadable or invalid; screen-aware and voice forced off');
    admin.values = { screenAware: false, voice: false, offline: true };
  }
  return admin;
}

/** True when the admin file forces "hide during screen sharing" on, so the menu shows it locked. */
export const hideLockedByAdmin = (): boolean => loadAdmin().values.hideInShares === true;

export function loadSettings(): Settings {
  const user = parseSettingsFile(readFile(join(app.getPath('userData'), 'settings.json')));
  const admin = loadAdmin();
  return mergeSettings(DEFAULT_SETTINGS, user.values, admin.values);
}

/** Persist a validated patch to the user's settings.json (atomic). The admin file still wins on the next loadSettings. */
export function saveSettings(patch: unknown): void {
  const p = parseSettingsFile(JSON.stringify(patch) ?? '');
  if (p.failed || p.invalid.length > 0 || Object.keys(p.values).length === 0) throw new Error('invalid settings patch');
  const dir = app.getPath('userData');
  const file = join(dir, 'settings.json');
  let current: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) current = raw as Record<string, unknown>;
  } catch {
    /* missing or corrupt: start fresh */
  }
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ ...current, ...p.values }, null, 2));
  renameSync(tmp, file);
}
