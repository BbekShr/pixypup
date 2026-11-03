import { NetworkBlockedError, openClient } from '../api/gate';
import type { MetaClientOptions } from '../api/meta-client';
import { sparkResponse } from '../api/muse-spark';
import type { Settings } from './settings';
import { errorCode } from './pet-input';

export type KeyVerdict = 'ok' | 'bad-key' | 'network';

const PING = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

/**
 * One tiny Muse Spark call, so a key typed outside pet creation is checked before it is stored.
 * Only a 401/403 rejects it; an admin's offline mode can't be checked, so the key is kept as typed.
 */
export async function tryKey(key: string, s: Pick<Settings, 'screenAware' | 'voice' | 'adminDisableScreenAware' | 'offline'>, opts: Omit<MetaClientOptions, 'apiKey'> = {}): Promise<KeyVerdict> {
  try {
    await sparkResponse(openClient('talk', s, key, opts), { instructions: 'Reply with ok.', input: 'ok', schema: PING, name: 'ping', effort: 'minimal', maxOutputTokens: 64, signal: AbortSignal.timeout(15_000) });
    return 'ok';
  } catch (err) {
    if (err instanceof NetworkBlockedError) return 'ok';
    const code = errorCode(err);
    return code === 'bad-key' || code === 'network' ? code : 'ok'; // any other answer means Meta accepted the key
  }
}

/** Check the key with one tiny call and store it only if Meta took it. `unsafe` = no Keychain encryption: never fall back to plain text. */
export async function storeKey(key: string, s: Parameters<typeof tryKey>[1], store: (key: string) => void, opts: Parameters<typeof tryKey>[2] = {}): Promise<KeyVerdict | 'unsafe'> {
  const v = await tryKey(key, s, opts);
  if (v !== 'ok') return v;
  try {
    store(key);
  } catch {
    return 'unsafe';
  }
  return 'ok';
}
