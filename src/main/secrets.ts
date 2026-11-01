import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// TODO(F1): move to Keychain-backed storage with key rotation.
const keyFile = (): string => join(app.getPath('userData'), 'api-key.bin');

export function setApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safeStorage unavailable');
  writeFileSync(keyFile(), safeStorage.encryptString(key));
}

export function getApiKey(): string | undefined {
  if (existsSync(keyFile()) && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(readFileSync(keyFile()));
    } catch {
      console.warn('[secrets] could not decrypt the stored key'); // fixed string: never the key or file contents
    }
  }
  return process.env.MODEL_API_KEY;
}
