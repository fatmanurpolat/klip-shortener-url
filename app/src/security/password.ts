/**
 * Password hashing for the optional email + password auth path.
 *
 * Uses Node's built-in scrypt (a memory-hard KDF) — no native dependency. The
 * raw password is NEVER stored or returned; only a self-describing hash string
 * `scrypt$N$r$p$saltHex$hashHex` is persisted in users.password_hash. The hash
 * embeds its own parameters so they can be tuned later without breaking old
 * hashes. Verification is constant-time (timingSafeEqual).
 *
 * SECURITY: the password is never placed in a cookie or any client-readable
 * store. After register/login the server issues the existing signed session
 * JWT cookie (see ../auth.ts); that token — not the password — authenticates
 * subsequent requests.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Cost parameters. N=2^15 keeps a single hash in the tens-of-ms range while
// 128*N*r bytes (~32 MB) of memory makes large-scale cracking expensive.
const N = 32768;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALT_BYTES = 16;
const MAXMEM = 64 * 1024 * 1024; // must exceed 128*N*r (~33.5 MB)

/** Hash a plaintext password into a self-describing scrypt string. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Verify a plaintext password against a stored scrypt hash (constant-time). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p) || n < 2) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], 'hex');
    expected = Buffer.from(parts[5], 'hex');
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
  } catch {
    return false;
  }
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
