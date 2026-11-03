// The only construction path for a MetaClient in the app. Enforces the enterprise promise:
// with screen-aware and voice off, no network calls except an explicit pet creation.
import type { Settings } from '../main/settings';
import { MetaClient, type MetaClientOptions } from './meta-client.js';

export type Purpose = 'create-pet' | 'screen' | 'voice' | 'talk';

export class NetworkBlockedError extends Error {
  constructor(readonly purpose: Purpose) {
    super(`Network blocked for "${purpose}" by settings`);
    this.name = 'NetworkBlockedError';
  }
}

type GateSettings = Pick<Settings, 'screenAware' | 'voice' | 'adminDisableScreenAware' | 'offline'>;

// The app sets Electron's net.fetch here: Chromium honours the Mac's proxy settings and Keychain root certificates, which
// Node's fetch ignores, so on a work laptop behind a proxy or TLS inspection every Meta call failed as "network".
let appFetch: typeof fetch | undefined;
export const useFetch = (f: typeof fetch): void => {
  appFetch = f;
};

// create-pet is always allowed: the user explicitly starts it and onboarding says it talks to Meta.
// offline (default false; admin-set) means "no background network": it blocks screen, voice and talk (talk is user-initiated per message but still network).
export function openClient(purpose: Purpose, s: GateSettings, apiKey: string, opts: Omit<MetaClientOptions, 'apiKey'> = {}): MetaClient {
  const allowed =
    purpose === 'create-pet' ||
    (!s.offline && (purpose === 'screen' ? s.screenAware && !s.adminDisableScreenAware : purpose === 'voice' ? s.voice : true));
  if (!allowed) throw new NetworkBlockedError(purpose);
  return new MetaClient({ ...(appFetch ? { fetchImpl: appFetch } : {}), ...opts, apiKey });
}
