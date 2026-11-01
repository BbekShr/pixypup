import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = vi.hoisted(() => ({ existsSync: vi.fn(() => true), readFileSync: vi.fn(() => Buffer.from('x')), writeFileSync: vi.fn() }));
vi.mock('node:fs', () => fs);
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  safeStorage: { isEncryptionAvailable: () => true, decryptString: () => { throw new Error('keychain locked'); }, encryptString: vi.fn() },
}));
const { getApiKey } = await import('./secrets');

describe('getApiKey', () => {
  beforeEach(() => { delete process.env['MODEL_API_KEY']; vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  it('falls back to the env key when decrypt throws', () => {
    process.env['MODEL_API_KEY'] = 'env-key';
    expect(getApiKey()).toBe('env-key');
  });
  it('returns undefined, not a throw, when there is no fallback', () => {
    expect(getApiKey()).toBeUndefined();
  });
  it('warns with a fixed string only', () => {
    getApiKey();
    expect(console.warn).toHaveBeenCalledWith('[secrets] could not decrypt the stored key');
  });
});
