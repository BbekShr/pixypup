import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../redact.js';

describe('redactSecrets', () => {
  it.each([
    ['Authorization: Bearer abc.def-123', 'abc.def'],
    ['key sk-proj-abcdef123456', 'abcdef123456'],
    ['ghp_abcdefghijklmnop1234', 'abcdefghijklmnop'],
    ['xoxb-1234-abcd-efghijkl', 'efghijkl'],
    ['API_KEY=hunter2hunter', 'hunter2hunter'],
    ['password: swordfish', 'swordfish'],
    ['git clone https://bob:s3cret@github.com/x/y', 's3cret'],
    ['hash 0123456789abcdef0123456789abcdef0123', '0123456789abcdef0123456789abcdef'],
  ])('redacts %s', (input, secret) => {
    const out = redactSecrets(input);
    expect(out).not.toContain(secret);
    expect(out).toContain('[redacted]');
  });

  it('leaves an ordinary vitest failure line unchanged', () => {
    const l = 'FAIL src/api/__tests__/sam.test.ts > segment > decodes mask (AssertionError: expected 3 to be 4)';
    expect(redactSecrets(l)).toBe(l);
    const u = 'https://example.com/a/b:80 at src/main/screen-loop.ts:79';
    expect(redactSecrets(u)).toBe(u);
  });
});
