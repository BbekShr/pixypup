import { app } from 'electron';
import { readFileSync } from 'node:fs';
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

export function loadSettings(): Settings {
  const user = parseSettingsFile(readFile(join(app.getPath('userData'), 'settings.json')));
  const admin = parseSettingsFile(readFile(ADMIN_FILE));
  if (admin.failed || admin.invalid.length > 0) {
    console.warn('PixyPup: admin.json unreadable or invalid; screen-aware and voice forced off');
    admin.values = { screenAware: false, voice: false, offline: true };
  }
  return mergeSettings(DEFAULT_SETTINGS, user.values, admin.values);
}
