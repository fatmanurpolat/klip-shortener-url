import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// Env must be set before codes.ts loads (it reads HASHIDS_SALT at import time).
process.env.HASHIDS_SALT ??= 'test-salt-please-change-me';
process.env.COUNTER_OFFSET ??= '14776336';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';

let codes: typeof import('./codes.js');

before(async () => {
  codes = await import('./codes.js');
});

test('1000 sequential inputs mint 1000 unique codes', () => {
  const seen = new Set<string>();
  for (let i = 0n; i < 1000n; i++) {
    seen.add(codes.mintCode(i));
  }
  assert.equal(seen.size, 1000, 'expected every minted code to be unique');
});

test('all minted codes are at least 4 characters', () => {
  for (let i = 0n; i < 1000n; i++) {
    const code = codes.mintCode(i);
    assert.ok(code.length >= 4, `code "${code}" (seq ${i}) is shorter than 4 chars`);
  }
});

test('mintCode(0n) and mintCode(1n) look unrelated, not sequential', () => {
  const a = codes.mintCode(0n);
  const b = codes.mintCode(1n);

  assert.notEqual(a, b);
  // "Sequential" would mean identical except the trailing char (e.g. 0001/0002).
  assert.notEqual(
    a.slice(0, -1),
    b.slice(0, -1),
    `codes look sequential: "${a}" vs "${b}"`,
  );
});

test('resolveId(mintCode(n)) === n + COUNTER_OFFSET', () => {
  for (const n of [0n, 1n, 42n, 9999n, 1_000_000n]) {
    const id = codes.resolveId(codes.mintCode(n));
    assert.equal(id, n + codes.COUNTER_OFFSET, `round-trip failed for seq ${n}`);
  }
});

test('resolveId returns null for an undecodable code', () => {
  // "!!!!" contains characters outside the alphabet → cannot decode.
  assert.equal(codes.resolveId('!!!!'), null);
});

test('encodeBase62(11157n) === "2TX" (worked example for this alphabet)', () => {
  assert.equal(codes.encodeBase62(11157n), '2TX');
});

test('decodeBase62("2TX") === 11157n', () => {
  assert.equal(codes.decodeBase62('2TX'), 11157n);
});

test('encodeBase62(decodeBase62(s)) === s round-trips for valid codes', () => {
  const samples = [1n, 62n, 63n, 11157n, 14776336n, 9_999_999_999n];
  for (const n of samples) {
    const s = codes.encodeBase62(n);
    assert.equal(codes.encodeBase62(codes.decodeBase62(s)), s);
    // and the value itself round-trips
    assert.equal(codes.decodeBase62(s), n);
  }
});
