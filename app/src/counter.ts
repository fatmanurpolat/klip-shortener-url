import { env } from './env';
import { getPool, getRedis } from './db';

/**
 * Atomic unique-ID counter. Every short link is assigned a strictly
 * increasing integer ID drawn from here. Two backends are supported,
 * selected by COUNTER_BACKEND:
 *
 *   - "redis"    : INCR on a single key (atomic across processes), with a
 *                  startup recovery step so IDs are never reissued after a
 *                  Redis data loss.
 *   - "postgres" : nextval() on a dedicated sequence (no Redis involved).
 *
 * Neither backend can return a duplicate, even under heavy concurrency:
 * Redis INCR and Postgres nextval() are both atomic.
 */

// 62^4 — the first 4-character base-62 short code. Keeps early codes a fixed
// width and non-trivial to guess.
export const COUNTER_OFFSET: bigint = BigInt(env.COUNTER_OFFSET);

/** Redis key holding the last issued ID. */
const COUNTER_KEY = 'klipo:counter';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Seed/recover the counter. Call exactly once during startup, before the app
 * begins serving requests. Idempotent: calling it again will not reset an
 * already-seeded counter.
 */
export async function initCounter(): Promise<void> {
  if (env.COUNTER_BACKEND === 'redis') {
    await initRedisCounter();
  } else {
    await initPostgresCounter();
  }
}

/**
 * Return the next unique ID. One call per shortened link. Never duplicates.
 */
export async function getNextId(): Promise<bigint> {
  if (env.COUNTER_BACKEND === 'redis') {
    const redis = getRedis();
    try {
      const next = await redis.incr(COUNTER_KEY);
      return BigInt(next);
    } catch (err) {
      throw new Error(
        `Klipo counter: INCR "${COUNTER_KEY}" failed — Redis unavailable at ${env.REDIS_URL}. ` +
          `Cause: ${describe(err)}`,
      );
    }
  }

  // postgres backend — no Redis dependency on this path.
  try {
    const res = await getPool().query<{ nextval: string }>(
      "SELECT nextval('link_id_seq') AS nextval",
    );
    return BigInt(res.rows[0].nextval);
  } catch (err) {
    throw new Error(
      `Klipo counter: nextval('link_id_seq') failed — Postgres unavailable at ${env.DATABASE_URL} ` +
        `or the sequence is missing (run db/init/001_schema.sql). Cause: ${describe(err)}`,
    );
  }
}

// -----------------------------------------------------------------------------
// Redis backend
// -----------------------------------------------------------------------------
async function initRedisCounter(): Promise<void> {
  const redis = getRedis();

  // Seed only if the key is absent (NX). Re-running never resets the counter.
  try {
    await redis.set(COUNTER_KEY, COUNTER_OFFSET.toString(), 'NX');
  } catch (err) {
    throw new Error(
      `Klipo counter: failed to seed "${COUNTER_KEY}" — Redis unavailable at ${env.REDIS_URL}. ` +
        `Cause: ${describe(err)}`,
    );
  }

  // Recovery: if Redis lost data and was reseeded below the highest ID we've
  // already persisted, fast-forward past it so we can never reissue an ID.
  let maxPersisted: bigint | null;
  try {
    const res = await getPool().query<{ max: string | null }>(
      'SELECT MAX(link_id) AS max FROM links_code_lookup',
    );
    const raw = res.rows[0]?.max;
    maxPersisted = raw != null ? BigInt(raw) : null;
  } catch (err) {
    throw new Error(
      `Klipo counter: recovery query against links_code_lookup failed — Postgres unavailable ` +
        `at ${env.DATABASE_URL}. Cause: ${describe(err)}`,
    );
  }

  if (maxPersisted !== null) {
    const currentRaw = await redis.get(COUNTER_KEY);
    const current = currentRaw != null ? BigInt(currentRaw) : COUNTER_OFFSET;
    if (maxPersisted > current) {
      await redis.set(COUNTER_KEY, (maxPersisted + 1n).toString());
    }
  }
}

// -----------------------------------------------------------------------------
// Postgres backend
// -----------------------------------------------------------------------------
async function initPostgresCounter(): Promise<void> {
  try {
    const res = await getPool().query(
      "SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'link_id_seq'",
    );
    if (res.rowCount === 0) {
      throw new Error(
        "sequence 'link_id_seq' not found — run db/init/001_schema.sql",
      );
    }
  } catch (err) {
    throw new Error(
      `Klipo counter: cannot initialize Postgres backend — Postgres unavailable at ` +
        `${env.DATABASE_URL} or schema not applied. Cause: ${describe(err)}`,
    );
  }
}
