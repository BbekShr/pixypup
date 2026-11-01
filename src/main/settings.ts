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

function readJson(path: string): Partial<Settings> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, 'utf8')) as Partial<Settings>;
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  const user = readJson(join(app.getPath('userData'), 'settings.json'));
  const admin = readJson(ADMIN_FILE);
  return mergeSettings(DEFAULT_SETTINGS, user, admin);
}
