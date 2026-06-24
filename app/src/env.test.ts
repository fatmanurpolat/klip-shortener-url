import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://klipo:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.HASHIDS_SALT ??= 'kliptestsalt0123456789abcdef';
process.env.SESSION_SECRET ??= 'kliptestsessionsecret0123456789abcdef';

let looksLikePlaceholderSecret: typeof import('./env.js').looksLikePlaceholderSecret;
before(async () => {
  ({ looksLikePlaceholderSecret } = await import('./env.js'));
});

test('placeholder/default secrets are detected (production guard)', () => {
  for (const v of [
    'CHANGE_ME',
    'change-me-please',
    'CHANGE_ME_USE_A_LONG_RANDOM_STRING',
    'your_secret_here',
    'postgres://klip:your_pass@postgres:5432/klip', // embedded placeholder (mid-string)
    'dev-klip-secret',
    'postgres://klip:CHANGE_ME@postgres:5432/klip',
  ]) {
    assert.equal(looksLikePlaceholderSecret(v), true, `expected "${v}" to be flagged`);
  }
});

test('real secrets / DB urls / undefined are NOT flagged', () => {
  assert.equal(looksLikePlaceholderSecret('Hk8s2Lp9Qz4Wm1Vn7Bx3Cy6De5Fg7'), false);
  assert.equal(looksLikePlaceholderSecret('postgres://klip:s3cretPass@postgres:5432/klip'), false);
  assert.equal(looksLikePlaceholderSecret(undefined), false);
});
