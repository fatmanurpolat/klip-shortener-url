import { env } from './env';
import { getPool, getRedis } from './db';
import { nextSnowflakeId, initSnowflake, SNOWFLAKE_EPOCH, MAX_MACHINE_ID } from './snowflake';

/**
 * Atomic unique-ID counter. Every short link is assigned a strictly
 * increasing integer ID drawn from here. Three backends are supported,
 * selected by COUNTER_BACKEND:
 *
 *   - "redis"     : INCR on a single key (atomic across processes), with a
 *                   startup recovery step so IDs are never reissued after a
 *                   Redis data loss.
 *   - "postgres"  : nextval() on a dedicated sequence (no Redis involved).
 *   - "snowflake" : local time-based id stamped with this node's MACHINE_ID, so
 *                   replicas mint ids independently with NO central counter (see
 *                   snowflake.ts). Requires a UNIQUE MACHINE_ID per replica.
 *
 * redis INCR and postgres nextval() are atomic; snowflake relies on a per-node
 * MACHINE_ID for cross-node uniqueness (NOT shared state).
 *
 * NOTE on ordering: redis/postgres ids are globally strictly-increasing. Snowflake
 * ids are strictly-increasing WITHIN one process; across nodes they order by the
 * (timestamp, machine, sequence) bit value, which is NOT time-causal under clock
 * skew. All three never repeat an id (snowflake only if MACHINE_IDs are unique).
 */

// The counter's starting value (default 0). NOTE: code WIDTH is controlled by
// Hashids MIN_LENGTH (4) in codes.ts, not by this offset — a large offset just
// pre-inflates the encoded integer and yields longer codes. Keep at 0 unless you
// deliberately want to start the ID space higher.
export const COUNTER_OFFSET: bigint = BigInt(env.COUNTER_OFFSET);

/** Redis key holding the last issued ID. */
const COUNTER_KEY = 'klipo:counter';

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Optional structured logger (the app's pino instance), set by initCounter. Used
// to surface post-failover recovery failures on the redis backend.
type CounterLog = {
  error: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  info: (obj: unknown, msg?: string) => void;
};
let counterLog: CounterLog | null = null;

/**
 * Seed/recover the counter. Call exactly once during startup, before the app
 * begins serving requests. Idempotent: calling it again will not reset an
 * already-seeded counter.
 */
export async function initCounter(log?: CounterLog): Promise<void> {
  counterLog = log ?? null;
  if (env.COUNTER_BACKEND === 'snowflake') {
    initSnowflakeCounter();
    return;
  }
  if (env.COUNTER_BACKEND === 'redis') {
    await initRedisCounter();
  } else {
    await initPostgresCounter();
  }
}

// -----------------------------------------------------------------------------
// Snowflake backend — time-based, no central store, no seeding/recovery. Just
// build the generator (validates MACHINE_ID) and warn LOUDLY if it's the shared
// default, since duplicate MACHINE_IDs across replicas would mint duplicate ids.
// -----------------------------------------------------------------------------
function initSnowflakeCounter(): void {
  // Enforce (not just document) COUNTER_OFFSET=0: shorten stores link_id = id +
  // COUNTER_OFFSET, so a non-zero offset on a full 63-bit snowflake id would
  // overflow BIGINT near the timestamp ceiling AND be double-applied by mintCode.
  if (BigInt(env.COUNTER_OFFSET) !== 0n) {
    throw new Error(
      `Klipo counter: COUNTER_BACKEND=snowflake requires COUNTER_OFFSET=0 (got ${env.COUNTER_OFFSET}) — ` +
        `a non-zero offset corrupts/overflows the 63-bit snowflake id.`,
    );
  }
  initSnowflake(); // constructs the default generator → throws if MACHINE_ID is out of range
  if (BigInt(env.MACHINE_ID) === 0n) {
    counterLog?.warn(
      { machineId: env.MACHINE_ID },
      `snowflake: MACHINE_ID is 0 (default). EVERY app replica MUST have a UNIQUE ` +
        `MACHINE_ID (0-${MAX_MACHINE_ID}) — \`docker compose --scale app=N\` shares one env, ` +
        `so without a per-replica MACHINE_ID two replicas WILL mint duplicate ids.`,
    );
  }
  counterLog?.info(
    { machineId: env.MACHINE_ID, epoch: SNOWFLAKE_EPOCH.toString() },
    'snowflake id generator ready',
  );
}

/**
 * Return the next unique ID. One call per shortened link. Never duplicates.
 */
export async function getNextId(): Promise<bigint> {
  if (env.COUNTER_BACKEND === 'snowflake') {
    // Local, time-based — no Redis/Postgres round-trip. Throws only if the clock
    // ran backwards; the caller surfaces a 503 and retries once it recovers.
    return nextSnowflakeId();
  }
  if (env.COUNTER_BACKEND === 'redis') {
    // If a Sentinel failover just promoted a replica, wait for the counter to be
    // fast-forwarded past the highest persisted id before INCRing — otherwise we
    // could hand out an ID the old master already issued (async replication lag).
    if (recoveryBarrier) await recoveryBarrier;
    const redis = getRedis();
    try {
      const next = await redis.incr(COUNTER_KEY);
      return BigInt(next);
    } catch (err) {
      throw new Error(
        `Klipo counter: INCR "${COUNTER_KEY}" failed — Redis unavailable (Sentinel or ` +
          `single-node). Cause: ${describe(err)}`,
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
// Atomic, MONOTONIC raise to maxPersisted+1 — only ever moves the counter UP.
// A non-atomic GET-then-SET is unsafe under concurrent boot (`--scale app=N`) and
// under failover: an instance/master that already advanced past this value must
// not be stomped back down. The Lua reads+compares+writes in one step, so a stale
// caller that sees a higher live counter leaves it alone.
const RAISE_COUNTER_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if tonumber(ARGV[1]) > cur then redis.call('SET', KEYS[1], ARGV[1]) end
return redis.call('GET', KEYS[1])
`;

/**
 * Fast-forward the Redis counter past the highest PERSISTED link id, so the next
 * INCR can never collide with an existing link. Runs at startup AND on every
 * Sentinel failover (see registerFailoverRecovery): a promoted replica can be
 * missing the old master's last few INCRs (async replication), and without this
 * the counter would hand those ids out a second time.
 */
async function recoverCounter(): Promise<void> {
  const res = await getPool().query<{ max: string | null }>(
    'SELECT MAX(link_id) AS max FROM links_code_lookup',
  );
  const raw = res.rows[0]?.max;
  if (raw == null) return; // no links yet — nothing to fast-forward past
  await getRedis().eval(RAISE_COUNTER_LUA, 1, COUNTER_KEY, (BigInt(raw) + 1n).toString());
}

// Post-failover gate. ioredis (Sentinel mode) re-emits 'ready' after it reconnects
// to a newly promoted master. We re-run recovery then, and getNextId() awaits this
// barrier so it never INCRs a stale counter on the new master.
let recoveryBarrier: Promise<void> | null = null;

function registerFailoverRecovery(redis: ReturnType<typeof getRedis>): void {
  // Re-run recovery on EVERY 'ready'. ioredis re-emits it after reconnecting to a
  // newly promoted master. We deliberately do NOT try to skip the first (startup)
  // 'ready': this listener is attached only after buildApp()'s async plugin/route
  // registration, so the startup 'ready' can fire BEFORE the listener exists — a
  // "skip first" heuristic would then silently disarm the FIRST real failover.
  // recoverCounter() is idempotent + monotonic, so a redundant startup run is free.
  //
  // CAVEAT (why the redis backend is "safe in practice", not absolute): ioredis
  // drains its offline queue synchronously on reconnect, one tick BEFORE this
  // 'ready' listener fires, so an INCR queued during the outage can land on a
  // not-yet-fast-forwarded promoted replica. COUNTER_BACKEND=postgres has no such
  // window and is the default — see docs/ha-redis-sentinel.md.
  redis.on('ready', () => {
    if (recoveryBarrier) return; // coalesce: one in-flight recovery is enough
    recoveryBarrier = recoverCounter()
      .catch((err) => {
        // Surface it: if Postgres is also down the barrier still clears, and
        // getNextId would resume INCRing a possibly-stale counter with no signal.
        counterLog?.error({ err }, 'counter: post-failover recovery failed');
      })
      .finally(() => {
        recoveryBarrier = null;
      });
  });
}

async function initRedisCounter(): Promise<void> {
  const redis = getRedis();

  // Seed only if the key is absent (NX). Re-running never resets the counter.
  try {
    await redis.set(COUNTER_KEY, COUNTER_OFFSET.toString(), 'NX');
  } catch (err) {
    throw new Error(
      `Klipo counter: failed to seed "${COUNTER_KEY}" — Redis unavailable. Cause: ${describe(err)}`,
    );
  }

  // Recovery: if Redis lost data / was reseeded below the highest persisted ID
  // (data loss OR a failover to a lagging replica), fast-forward past it.
  try {
    await recoverCounter();
  } catch (err) {
    throw new Error(
      `Klipo counter: startup recovery against links_code_lookup failed — Postgres unavailable ` +
        `at ${env.DATABASE_URL}. Cause: ${describe(err)}`,
    );
  }

  // From now on, follow Sentinel failovers automatically.
  registerFailoverRecovery(redis);
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

  // Align the sequence with the highest persisted id so nextval() can NEVER
  // collide with an existing link — covering a fresh sequence, a Postgres restore,
  // AND a switch from the Redis counter (the sequence sat UNUSED while ids were
  // minted from Redis, so it may carry a stale START far from the real ids).
  //   - is_called = false  → the sequence never issued anything, so its value is
  //     just a nominal START. Reset it to MAX(link_id) → next is MAX+1 (small,
  //     consecutive ids), regardless of whatever START the schema declared.
  //   - is_called = true   → genuinely in use; only raise via GREATEST(last_value,
  //     MAX) so we never lower it (which keeps concurrent boots / `--scale app=N`
  //     safe — a peer that already advanced it isn't stomped).
  // Skipped when there are no links (WHERE maxid IS NOT NULL) so a fresh DB still
  // issues nextval()=1. Assumes COUNTER_OFFSET=0 (the supported value: link_id ==
  // sequence value).
  try {
    await getPool().query(
      `SELECT setval('link_id_seq',
                CASE WHEN s.is_called THEN GREATEST(s.last_value, m.maxid)
                     ELSE m.maxid END)
         FROM link_id_seq s,
              (SELECT MAX(link_id) AS maxid FROM links_code_lookup) m
        WHERE m.maxid IS NOT NULL`,
    );
  } catch (err) {
    throw new Error(
      `Klipo counter: failed to fast-forward link_id_seq past existing links — ` +
        `Postgres unavailable at ${env.DATABASE_URL}. Cause: ${describe(err)}`,
    );
  }
}
