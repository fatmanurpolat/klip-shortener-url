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

export type Tombstone = 'EXPIRED' | 'DELETED' | 'NOT_FOUND';

const TOMBSTONES = new Set<string>(['EXPIRED', 'DELETED', 'NOT_FOUND']);
const TOMBSTONE_TTL = 60; // seconds

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

/** Cache a resolved destination URL with the standard TTL. */
export async function setCachedUrl(code: string, url: string): Promise<void> {
  await getRedis().set(urlKey(code), url, 'EX', env.REDIS_URL_TTL);
}

/** Cache a negative result (expired / deleted / not-found) for 60s. */
export async function setTombstone(code: string, type: Tombstone): Promise<void> {
  await getRedis().set(urlKey(code), type, 'EX', TOMBSTONE_TTL);
}

/** Remove a cached entry entirely (forces a DB re-resolve on next request). */
export async function invalidateCachedUrl(code: string): Promise<void> {
  await getRedis().del(urlKey(code));
}
