import { getRedis } from './db';
import { env } from './env';

/**
 * Redis caching layer for the redirect hot path. The goal: nearly every redirect
 * is answered from Redis with no SQL. (Rate limiting lives in security/rateLimit.ts.)
 *
 * Key schema:
 *   klipo:url:{code}  → long_url string (TTL = REDIS_URL_TTL), OR a tombstone.
 * Tombstones (negative cache, TTL = 60s): "EXPIRED" | "DELETED" | "NOT_FOUND".
 */

// EXPIRED/DELETED/NOT_FOUND are genuine negatives → 404. DISABLED is special: the
// link exists but an admin turned it off → the redirect serves the 200 "disabled"
// page, and setCachedUrl refuses to overwrite it (see SET_URL_UNLESS_DISABLED).
export type Tombstone = 'EXPIRED' | 'DELETED' | 'NOT_FOUND' | 'DISABLED';

const TOMBSTONES = new Set<string>(['EXPIRED', 'DELETED', 'NOT_FOUND', 'DISABLED']);
const TOMBSTONE_TTL = 60; // seconds

// A URL write must NEVER clobber a DISABLED marker. Without this, a redirect that
// read a link as live just BEFORE an admin disabled it could re-cache the live URL
// on top of the marker (TOCTOU) and keep 302-ing a disabled link for up to the URL
// TTL. The marker write (setTombstone) is an unconditional SET so it always wins the
// race; this conditional URL write loses it. KEYS[1]=urlKey, ARGV[1]=url, ARGV[2]=ttl.
const SET_URL_UNLESS_DISABLED = `
if redis.call('GET', KEYS[1]) == 'DISABLED' then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1
`;

const urlKey = (code: string): string => `klipo:url:${code}`;

export type CachedUrl = { url: string } | { tombstone: Tombstone } | null;

/**
 * Read the cached state for a code:
 *   - null            → cache miss (caller should hit the DB)
 *   - { tombstone }   → known-negative (expired / deleted / never existed)
 *   - { url }         → cached destination
 */
export async function getCachedUrl(code: string): Promise<CachedUrl> {
  const value = await getRedis().get(urlKey(code));
  if (value === null) return null;
  if (TOMBSTONES.has(value)) return { tombstone: value as Tombstone };
  // Tolerate legacy {"u":...,"id":...} entries written before plain-URL caching.
  if (value.charCodeAt(0) === 0x7b /* "{" */) {
    try {
      const obj = JSON.parse(value) as { u?: unknown };
      if (typeof obj.u === 'string') return { url: obj.u };
    } catch {
      /* not JSON — treat as a plain URL */
    }
  }
  return { url: value };
}

/**
 * Cache a resolved destination URL with the standard TTL — UNLESS the key already
 * holds a DISABLED marker, in which case this is a no-op (a disabled link must
 * never be resurrected by a racing redirect's cache write). All other states
 * (absent, a URL, or a stale EXPIRED/DELETED/NOT_FOUND tombstone) are overwritten.
 */
export async function setCachedUrl(code: string, url: string): Promise<void> {
  await getRedis().eval(SET_URL_UNLESS_DISABLED, 1, urlKey(code), url, String(env.REDIS_URL_TTL));
}

/** Cache a negative result (expired / deleted / not-found) for 60s. */
export async function setTombstone(code: string, type: Tombstone): Promise<void> {
  await getRedis().set(urlKey(code), type, 'EX', TOMBSTONE_TTL);
}

/** Remove a cached entry entirely (forces a DB re-resolve on next request). */
export async function invalidateCachedUrl(code: string): Promise<void> {
  await getRedis().del(urlKey(code));
}
