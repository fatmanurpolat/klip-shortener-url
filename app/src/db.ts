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
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 10 });
  }
  return pool;
}

/** Redis client (created on first use). */
export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
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
