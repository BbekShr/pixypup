import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Settings {
  screenAware: boolean;
  voice: boolean;
  offline: boolean;
  adminDisableScreenAware: boolean;
  petName: string;
}

export const DEFAULT_SETTINGS: Settings = {
  screenAware: false,
  voice: false,
  offline: true,
  adminDisableScreenAware: false,
  petName: 'Pakkun',
};

export const ADMIN_FILE = '/Library/Application Support/PixyPup/admin.json';

export function mergeSettings(
  defaults: Settings,
  user: Partial<Settings> = {},
  admin: Partial<Settings> = {},
): Settings {
  const merged: Settings = { ...defaults, ...user, ...admin };
  if (merged.adminDisableScreenAware) merged.screenAware = false;
  return merged;
}

const BOOLEAN_KEYS = ['screenAware', 'voice', 'offline', 'adminDisableScreenAware'] as const;

// null = file missing. Wrong-typed or unknown keys are dropped so e.g. "false" can't read as truthy.
export function parseSettingsFile(text: string | null | Error): {
  values: Partial<Settings>;
  failed: boolean;
} {
  if (text === null) return { values: {}, failed: false };
  if (text instanceof Error) return { values: {}, failed: true };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { values: {}, failed: true };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { values: {}, failed: true };
  }
  const obj = raw as Record<string, unknown>;
  const values: Partial<Settings> = {};
  for (const k of BOOLEAN_KEYS) if (typeof obj[k] === 'boolean') values[k] = obj[k];
  const name = obj.petName;
  if (typeof name === 'string' && name.length > 0 && name.length <= 40) values.petName = name;
  return { values, failed: false };
}

function readFile(path: string): string | null | Error {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf8');
  } catch (e) {
    return e instanceof Error ? e : new Error('read failed');
  }
}

export function loadSettings(): Settings {
  const user = parseSettingsFile(readFile(join(app.getPath('userData'), 'settings.json')));
  const admin = parseSettingsFile(readFile(ADMIN_FILE));
  if (admin.failed) {
    console.warn('PixyPup: admin.json unreadable or invalid; screen-aware and voice forced off');
    admin.values = { screenAware: false, voice: false };
  }
  return mergeSettings(DEFAULT_SETTINGS, user.values, admin.values);
}
