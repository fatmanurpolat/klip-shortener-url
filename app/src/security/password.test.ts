import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password';

test('hashPassword produces a self-describing scrypt string and never the plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');
  const parts = hash.split('$');
  assert.equal(parts[0], 'scrypt');
  assert.equal(parts.length, 6);
  assert.ok(!hash.includes('correct horse battery staple'));
});

test('a fresh hash verifies against its own password', async () => {
  const hash = await hashPassword('s3cret-passw0rd');
  assert.equal(await verifyPassword('s3cret-passw0rd', hash), true);
});

test('a wrong password does not verify', async () => {
  const hash = await hashPassword('s3cret-passw0rd');
  assert.equal(await verifyPassword('wrong-password', hash), false);
});

test('two hashes of the same password differ (random salt)', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same-password', a), true);
  assert.equal(await verifyPassword('same-password', b), true);
});

test('malformed stored hashes are rejected, not thrown', async () => {
  for (const bad of ['', 'not-a-hash', 'scrypt$32768$8$1$onlyfive', 'bcrypt$1$2$3$4$5']) {
    assert.equal(await verifyPassword('whatever', bad), false);
  }
});

test('unicode passwords are normalized so equivalent forms match', async () => {
  // "é" composed (U+00E9) vs decomposed (e + U+0301) — NFKC makes them equal.
  const hash = await hashPassword('café');
  assert.equal(await verifyPassword('café', hash), true);
});
