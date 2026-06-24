import { setCachedUrl } from '../cache';
import { Cache } from '../ports';

/** Cache adapter delegating to the Redis-backed cache module. */
export function createRedisCache(): Cache {
  return { cacheUrl: (code, url) => setCachedUrl(code, url) };
}
