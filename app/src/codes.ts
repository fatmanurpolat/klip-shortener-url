import Hashids from 'hashids';

/**
 * Short-code generation.
 *
 * A unique integer ID (counter value + offset) is turned into a short,
 * unguessable base62 string with Hashids. The secret salt deterministically
 * shuffles the alphabet, so:
 *   - the same integer always yields the same code (reversible), and
 *   - consecutive integers yield codes that look unrelated (not sequential).
 *
 * The only source of "randomness" is the salt — no hashing (MD5/SHA/CRC) and
 * no RNG are involved.
 */

// Exactly 62 characters: digits, then lowercase, then uppercase.
export const ALPHABET =
  '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Offset applied to the raw counter value before encoding. Must match the
// value used by the counter module (env COUNTER_OFFSET, default 62^4) so that
// codes and IDs line up across the system.
export const COUNTER_OFFSET: bigint = BigInt(
  process.env.COUNTER_OFFSET ?? '14776336',
);

const salt = process.env.HASHIDS_SALT;
if (!salt) {
  throw new Error(
    'Klipo codes: HASHIDS_SALT is not set. Refusing to generate short codes ' +
      'without a salt — set HASHIDS_SALT to a long, random, secret string.',
  );
}

const MIN_LENGTH = 4;
const hashids = new Hashids(salt, MIN_LENGTH, ALPHABET);

/**
 * Turn a raw counter value into a short code.
 * @param seq the counter value as returned by getNextId()
 * @returns a base62 code, always >= 4 chars (minLength + offset)
 */
export function mintCode(seq: bigint): string {
  const id = COUNTER_OFFSET + seq;
  return hashids.encode(id.toString());
}

/**
 * Decode a short code back to its integer ID (COUNTER_OFFSET + seq).
 * @returns the decoded ID, or null if the code can't be decoded.
 */
export function resolveId(code: string): bigint | null {
  try {
    // Hashids throws on characters outside the alphabet, and returns an empty
    // array for structurally invalid codes — both mean "not decodable".
    const decoded = hashids.decode(code);
    if (decoded.length === 0) return null;
    return BigInt(decoded[0] as number | bigint);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Reference base62 conversion — pure, no Hashids. For documentation and tests;
// not used by mintCode/resolveId.
// -----------------------------------------------------------------------------

const BASE = 62n;

/** Pure base62 encode: repeated division by 62, remainders mapped via ALPHABET. */
export function encodeBase62(n: bigint): string {
  if (n < 0n) {
    throw new Error('encodeBase62: input must be non-negative');
  }
  if (n === 0n) return ALPHABET[0];

  let x = n;
  let out = '';
  while (x > 0n) {
    const rem = Number(x % BASE);
    out = ALPHABET[rem] + out;
    x = x / BASE;
  }
  return out;
}

/** Pure base62 decode via Horner's method: n = n * 62 + indexOf(char). */
export function decodeBase62(code: string): bigint {
  let n = 0n;
  for (const ch of code) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new Error(`decodeBase62: invalid base62 character "${ch}"`);
    }
    n = n * BASE + BigInt(idx);
  }
  return n;
}
