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
