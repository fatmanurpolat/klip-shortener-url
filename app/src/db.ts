import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';

/**
 * Shared backing-store clients. Both are lazy singletons so importing this
 * module is side-effect free until a client is actually requested — which
 * also lets tests inject fakes via {@link __setClientsForTest} before any
 * real connection is opened.
 */

let pool: Pool | null = null;
let redis: Redis | null = null;

/** Postgres connection pool (created on first use). */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env.DATABASE_URL, max: env.PG_POOL_MAX });
  }
  return pool;
}

/**
 * Redis client (created on first use). Two modes:
 *   - Sentinel (REDIS_SENTINELS set) → connects through Sentinel and transparently
 *     follows master failover. ioredis re-resolves the master from Sentinel on
 *     every (re)connect, so an INCR/GET after a failover lands on the NEW master.
 *   - Single-node (default) → REDIS_URL directly (local dev / tests).
 */
export function getRedis(): Redis {
  if (!redis) {
    if (env.REDIS_SENTINELS) {
      const sentinels = env.REDIS_SENTINELS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((hostPort) => {
          const idx = hostPort.lastIndexOf(':');
          const host = idx === -1 ? hostPort : hostPort.slice(0, idx);
          const port = idx === -1 ? 26379 : Number(hostPort.slice(idx + 1)) || 26379;
          return { host, port };
        });
      redis = new Redis({
        sentinels,
        name: env.REDIS_MASTER_NAME,
        // Back off on a flapping connection; cap at 2s so we reconnect promptly
        // once the new master is elected.
        retryStrategy: (times) => Math.min(times * 100, 2000),
        sentinelRetryStrategy: (times) => Math.min(times * 100, 2000),
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
    } else {
      redis = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      });
    }
  }
  return redis;
}

/** Close both clients. Safe to call when they were never created. */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
  }
  if (redis) {
    redis.disconnect();
    redis = null;
  }
}

/**
 * TEST SEAM — replace the cached clients with fakes. Not for production use.
 * Pass `null` to force re-creation of a real client on next access.
 */
export function __setClientsForTest(clients: {
  pool?: Pool | null;
  redis?: Redis | null;
}): void {
  if ('pool' in clients) pool = (clients.pool ?? null) as Pool | null;
  if ('redis' in clients) redis = (clients.redis ?? null) as Redis | null;
}
