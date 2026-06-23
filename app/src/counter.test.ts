import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Env must be set before env.ts (imported transitively by counter.ts) loads.
process.env.NODE_ENV = 'test';
process.env.COUNTER_BACKEND = 'redis';
process.env.COUNTER_OFFSET = '14776336';
process.env.DATABASE_URL ??= 'postgres://klipo:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.HASHIDS_SALT ??= 'test-salt-0123456789-abcdef';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';

// -----------------------------------------------------------------------------
// Minimal in-memory fakes. Because Node runs the JS body of each async method
// to completion before yielding, the read-modify-write in `incr` is atomic —
// exactly the property real Redis INCR guarantees.
// -----------------------------------------------------------------------------
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async set(key: string, value: string | number, mode?: string) {
      if (mode === 'NX' && store.has(key)) return null;
      store.set(key, String(value));
      return 'OK';
    },
    async incr(key: string) {
      const cur = store.has(key) ? BigInt(store.get(key)!) : 0n;
      const next = cur + 1n;
      store.set(key, next.toString());
      return Number(next);
    },
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    // Mirrors the monotonic-raise Lua in initRedisCounter: only ever moves the
    // key UP to ARGV[1]. Body runs to completion before yielding, so it's atomic
    // (the real Redis EVAL guarantee). Signature: eval(script, numKeys, key, arg).
    async eval(_script: string, _numKeys: number, key: string, arg: string) {
      const cur = store.has(key) ? BigInt(store.get(key)!) : 0n;
      const target = BigInt(arg);
      if (target > cur) store.set(key, target.toString());
      return store.get(key)!;
    },
    // The Sentinel failover hook registers a 'ready' listener; the fake never
    // emits, so this is an inert no-op (single-node behavior is unchanged).
    on() {
      return this;
    },
  };
}

/** Fake pg pool whose recovery query reports a configurable MAX(link_id). */
function makeFakePool(maxLinkId: bigint | null) {
  return {
    async query(sql: string) {
      if (/MAX\(link_id\)/i.test(sql)) {
        return { rows: [{ max: maxLinkId === null ? null : maxLinkId.toString() }], rowCount: 1 };
      }
      if (/nextval/i.test(sql)) {
        // not used by the redis-backend tests
        return { rows: [{ nextval: '0' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

// Loaded once env is in place.
let db: typeof import('./db.js');
let counter: typeof import('./counter.js');

before(async () => {
  db = await import('./db.js');
  counter = await import('./counter.js');
});

beforeEach(() => {
  // Fresh, isolated state per test; empty link table (no recovery needed).
  db.__setClientsForTest({
    redis: makeFakeRedis() as unknown as import('ioredis').default,
    pool: makeFakePool(null) as unknown as import('pg').Pool,
  });
});

test('100 concurrent getNextId() calls return 100 unique IDs', async () => {
  await counter.initCounter();

  const ids = await Promise.all(
    Array.from({ length: 100 }, () => counter.getNextId()),
  );

  assert.equal(ids.length, 100);
  const unique = new Set(ids.map((id) => id.toString()));
  assert.equal(unique.size, 100, 'expected all 100 IDs to be distinct');
});

test('every ID is >= COUNTER_OFFSET', async () => {
  await counter.initCounter();

  const ids = await Promise.all(
    Array.from({ length: 50 }, () => counter.getNextId()),
  );

  for (const id of ids) {
    assert.ok(id >= counter.COUNTER_OFFSET, `${id} should be >= ${counter.COUNTER_OFFSET}`);
  }
});

test('calling initCounter() twice does not reset the counter', async () => {
  await counter.initCounter();

  const first = await counter.getNextId();
  const second = await counter.getNextId();

  // Re-init must be a no-op (NX seed + idempotent recovery).
  await counter.initCounter();

  const third = await counter.getNextId();

  assert.ok(second > first, 'counter should advance');
  assert.ok(third > second, 'counter must continue, not reset to the offset');
  assert.notEqual(third.toString(), (counter.COUNTER_OFFSET + 1n).toString());
});

test('recovery fast-forwards past the highest persisted ID', async () => {
  const maxPersisted = counter.COUNTER_OFFSET + 500n;
  db.__setClientsForTest({
    redis: makeFakeRedis() as unknown as import('ioredis').default,
    pool: makeFakePool(maxPersisted) as unknown as import('pg').Pool,
  });

  await counter.initCounter();
  const id = await counter.getNextId();

  assert.ok(id > maxPersisted, `recovered ID ${id} must exceed persisted max ${maxPersisted}`);
});

test('getNextId() throws a clear error when Redis is unavailable', async () => {
  const brokenRedis = {
    async set() {
      return 'OK';
    },
    async get() {
      return null;
    },
    async incr() {
      throw new Error('connect ECONNREFUSED');
    },
    on() {
      return this;
    },
  };
  db.__setClientsForTest({
    redis: brokenRedis as unknown as import('ioredis').default,
    pool: makeFakePool(null) as unknown as import('pg').Pool,
  });

  await counter.initCounter();
  await assert.rejects(
    () => counter.getNextId(),
    /Redis unavailable/,
    'error message should mention Redis is unavailable',
  );
});

test('postgres backend draws IDs from nextval()', async () => {
  const original = process.env.COUNTER_BACKEND;
  counter; // ensure loaded
  // getNextId / initCounter read env.COUNTER_BACKEND dynamically.
  const env = (await import('./env.js')).env;
  env.COUNTER_BACKEND = 'postgres';

  let seq = counter.COUNTER_OFFSET;
  const fakePool = {
    async query(sql: string) {
      if (/pg_class/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (/nextval/i.test(sql)) {
        seq += 1n;
        return { rows: [{ nextval: seq.toString() }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  db.__setClientsForTest({ pool: fakePool as unknown as import('pg').Pool });

  try {
    await counter.initCounter();
    const a = await counter.getNextId();
    const b = await counter.getNextId();
    assert.ok(b > a, 'sequence IDs must increase');
    assert.ok(a >= counter.COUNTER_OFFSET);
  } finally {
    env.COUNTER_BACKEND = original as 'redis' | 'postgres';
  }
});

test('postgres backend fast-forwards link_id_seq past existing links on init', async () => {
  // Guards the switch FROM the Redis counter: the sequence sat unused (behind
  // MAX(link_id)) while ids came from Redis, so init MUST advance it or nextval()
  // would reissue ids 1,2,3… that already belong to links.
  const env = (await import('./env.js')).env;
  const original = env.COUNTER_BACKEND;
  env.COUNTER_BACKEND = 'postgres';

  const queries: string[] = [];
  const fakePool = {
    async query(sql: string) {
      queries.push(sql);
      if (/pg_class/i.test(sql)) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
  };
  db.__setClientsForTest({ pool: fakePool as unknown as import('pg').Pool });

  try {
    await counter.initCounter();
    assert.ok(
      queries.some((q) => /setval\('link_id_seq'/i.test(q) && /MAX\(link_id\)/i.test(q)),
      'init must issue a setval() that fast-forwards link_id_seq past MAX(link_id)',
    );
  } finally {
    env.COUNTER_BACKEND = original as 'redis' | 'postgres';
  }
});
