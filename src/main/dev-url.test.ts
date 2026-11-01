import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false } }));
const { devRendererUrl } = await import('./dev-url.js');

describe('devRendererUrl', () => {
  const env = { ELECTRON_RENDERER_URL: 'http://evil.example' };
  it('ignores the env var when packaged', () => expect(devRendererUrl(true, env)).toBeUndefined());
  it('honours it in dev', () => expect(devRendererUrl(false, env)).toBe('http://evil.example'));
  it('is undefined when unset', () => expect(devRendererUrl(false, {})).toBeUndefined());
});
