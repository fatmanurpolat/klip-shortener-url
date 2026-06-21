import Hashids from 'hashids';
import { env } from '../env';

// Minimum slug length of 5 keeps short links tidy while leaving room to grow.
const hashids = new Hashids(env.HASHIDS_SALT, 5);

/**
 * Encode a monotonic counter value into an opaque short-link slug.
 * COUNTER_OFFSET pads the input so early slugs are not trivially guessable.
 */
export function encodeId(counter: number): string {
  return hashids.encode(env.COUNTER_OFFSET + counter);
}

/**
 * Reverse {@link encodeId}. Returns the original counter value, or `null`
 * if the slug is malformed or decodes to an out-of-range value.
 */
export function decodeId(slug: string): number | null {
  const decoded = hashids.decode(slug);
  if (decoded.length === 0) return null;

  const value = Number(decoded[0]) - env.COUNTER_OFFSET;
  return Number.isInteger(value) && value >= 0 ? value : null;
}
