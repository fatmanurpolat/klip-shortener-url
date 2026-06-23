import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// Env must be in place before env.ts loads (imported transitively by snowflake.ts),
// so the module is loaded dynamically in a before() hook (top-level await isn't
// available under the CommonJS build target).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://klipo:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.HASHIDS_SALT ??= 'test-salt-0123456789-abcdef';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';

let SnowflakeGenerator: typeof import('./snowflake.js').SnowflakeGenerator;
let nextSnowflakeId: typeof import('./snowflake.js').nextSnowflakeId;
let snowflakeTimestamp: typeof import('./snowflake.js').snowflakeTimestamp;
let snowflakeMachineId: typeof import('./snowflake.js').snowflakeMachineId;
let snowflakeSequence: typeof import('./snowflake.js').snowflakeSequence;
let SNOWFLAKE_EPOCH: bigint;
let MAX_MACHINE_ID: bigint;

before(async () => {
  ({
    SnowflakeGenerator,
    nextSnowflakeId,
    snowflakeTimestamp,
    snowflakeMachineId,
    snowflakeSequence,
    SNOWFLAKE_EPOCH,
    MAX_MACHINE_ID,
  } = await import('./snowflake.js'));
});

test('10,000 ids in a tight loop are all unique', () => {
  const seen = new Set<bigint>();
  for (let i = 0; i < 10_000; i++) seen.add(nextSnowflakeId());
  assert.equal(seen.size, 10_000, 'expected 10,000 distinct ids');
});

test('all ids are positive (sign bit stays 0)', () => {
  const gen = new SnowflakeGenerator(7n);
  for (let i = 0; i < 5_000; i++) {
    const id = gen.next();
    assert.ok(id > 0n, `id ${id} must be positive`);
    assert.ok(id <= (1n << 63n) - 1n, `id ${id} must fit in a signed 64-bit (BIGINT)`);
  }
});

test('ids are strictly monotonically increasing within a machine', () => {
  const gen = new SnowflakeGenerator(0n);
  let prev = gen.next();
  for (let i = 0; i < 10_000; i++) {
    const id = gen.next();
    assert.ok(id > prev, `id ${id} must be greater than previous ${prev}`);
    prev = id;
  }
});

test('embedded timestamp decodes to within 1s of Date.now()', () => {
  const id = nextSnowflakeId();
  const tsMs = Number(snowflakeTimestamp(id)); // absolute ms = (id >> 22) + EPOCH
  assert.ok(Math.abs(tsMs - Date.now()) < 1000, `decoded ts ${tsMs} not within 1s of now`);
});

test('different machines at the same timestamp produce different ids', () => {
  // Pin both generators to the SAME frozen clock so the timestamp bits are
  // identical; only the machine bits differ → ids must differ.
  const frozen = Date.UTC(2026, 5, 1); // a fixed instant after EPOCH
  const a = new SnowflakeGenerator(1n, { clock: () => frozen });
  const b = new SnowflakeGenerator(2n, { clock: () => frozen });
  const idA = a.next();
  const idB = b.next();
  assert.notEqual(idA, idB, 'distinct machine ids must yield distinct ids at the same ts');
  assert.equal(snowflakeTimestamp(idA), snowflakeTimestamp(idB), 'same frozen ts');
  assert.equal(snowflakeMachineId(idA), 1n);
  assert.equal(snowflakeMachineId(idB), 2n);
});

test('decoding round-trips timestamp / machine / sequence', () => {
  const frozen = Date.UTC(2026, 3, 15);
  const gen = new SnowflakeGenerator(513n, { clock: () => frozen });
  const id0 = gen.next();
  const id1 = gen.next(); // same frozen ms → sequence advances
  assert.equal(snowflakeMachineId(id0), 513n);
  assert.equal(snowflakeSequence(id0), 0n);
  assert.equal(snowflakeSequence(id1), 1n);
  assert.equal(Number(snowflakeTimestamp(id0)), frozen);
});

test('MACHINE_ID out of range is rejected', () => {
  assert.throws(() => new SnowflakeGenerator(-1n), /MACHINE_ID must be 0/);
  assert.throws(() => new SnowflakeGenerator(MAX_MACHINE_ID + 1n), /MACHINE_ID must be 0/);
  assert.doesNotThrow(() => new SnowflakeGenerator(MAX_MACHINE_ID));
});

test('a backwards clock is REFUSED (no duplicate / non-monotonic ids)', () => {
  let t = Date.UTC(2026, 5, 1);
  const gen = new SnowflakeGenerator(0n, { clock: () => t });
  gen.next();
  t -= 50; // clock jumps backwards 50ms
  assert.throws(() => gen.next(), /clock moved backwards/);
});

test('a pre-EPOCH clock is REFUSED (no negative id)', () => {
  const gen = new SnowflakeGenerator(0n, { clock: () => Date.UTC(2025, 0, 1) }); // before 2026
  assert.throws(() => gen.next(), /before EPOCH/);
});

test('per-ms sequence overflow rolls to the next ms (no dup, still increasing)', () => {
  // Clock advances 1ms every 8192 calls — comfortably above the 4096/ms cap, so a
  // full ms of ids is minted before the clock ticks, exercising the overflow spin.
  let calls = 0;
  const base = Date.UTC(2026, 5, 1);
  const clock = () => {
    calls++;
    return base + Math.floor(calls / 8192);
  };
  const gen = new SnowflakeGenerator(0n, { clock });
  const seen = new Set<bigint>();
  let prev = -1n;
  for (let i = 0; i < 4_200; i++) {
    // > 4096 ids → at least one sequence overflow + spin into the next ms.
    const id = gen.next();
    assert.ok(id > prev, 'strictly increasing across the overflow boundary');
    seen.add(id);
    prev = id;
  }
  assert.equal(seen.size, 4_200, 'no duplicates across the overflow boundary');
});

test('SNOWFLAKE_EPOCH is 2026-01-01T00:00:00Z', () => {
  assert.equal(SNOWFLAKE_EPOCH, BigInt(Date.UTC(2026, 0, 1)));
});

test('a 63-bit snowflake id round-trips through Hashids mintCode/resolveId', async () => {
  // The integration risk: snowflake ids exceed 2^53, so Hashids MUST handle BigInt
  // without lossy Number coercion, or codes would collide / mis-resolve.
  const codes = await import('./codes.js'); // COUNTER_OFFSET defaults to 0 here
  for (let i = 0; i < 200; i++) {
    const id = nextSnowflakeId();
    assert.ok(id > 1n << 53n, 'id should exceed JS safe-integer range');
    const code = codes.mintCode(id);
    assert.equal(codes.resolveId(code), id, `mintCode→resolveId must round-trip ${id}`);
  }
});
