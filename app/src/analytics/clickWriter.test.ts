import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Env must be in place before env.ts loads (imported transitively via db.ts).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://klipo:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.HASHIDS_SALT ??= 'test-salt-0123456789-abcdef';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';

// Capture every SQL the batch writer issues against a fake pool/client.
const queries: Array<{ sql: string; values: unknown[] }> = [];
function makeFakePool() {
  return {
    async connect() {
      return {
        async query(sql: string, values?: unknown[]) {
          queries.push({ sql, values: values ?? [] });
          return { rows: [], rowCount: 0 };
        },
        release() {
          /* no-op */
        },
      };
    },
  };
}

let db: typeof import('../db.js');
let cw: typeof import('./clickWriter.js');

before(async () => {
  db = await import('../db.js');
  cw = await import('./clickWriter.js');
});

beforeEach(() => {
  queries.length = 0;
  db.__setClientsForTest({ pool: makeFakePool() as unknown as import('pg').Pool });
});

function ev(linkId: bigint): import('./clickWriter.js').ClickEvent {
  return {
    linkId,
    createdAt: new Date('2026-06-23T00:00:00Z'),
    ipHash: Buffer.alloc(16),
    country: 'US',
    referer: '',
    uaBrowser: 'Chrome',
    uaOs: 'macOS',
    uaDevice: 'desktop',
    uaNetwork: null,
    isWebview: false,
  };
}

test('stopClickWriter() flushes queued clicks before shutdown (no loss)', async () => {
  cw.enqueueClick(ev(1n));
  cw.enqueueClick(ev(1n));
  cw.enqueueClick(ev(2n));

  // This is what app.ts onClose calls on SIGTERM, before the pool closes.
  await cw.stopClickWriter();

  const sqls = queries.map((q) => q.sql);
  assert.ok(sqls.some((s) => /INSERT INTO clicks\b/i.test(s)), 'raw clicks INSERT ran');
  assert.ok(sqls.some((s) => /clicks_daily/i.test(s)), 'daily rollup UPSERT ran');
  assert.ok(
    sqls.some((s) => /^BEGIN/i.test(s)) && sqls.some((s) => /^COMMIT/i.test(s)),
    'batch was committed in a transaction',
  );

  // The raw INSERT carried all three buffered events (10 columns each).
  const insert = queries.find((q) => /INSERT INTO clicks\b/i.test(q.sql));
  assert.equal(insert?.values.length, 3 * 10, 'all 3 queued clicks were written');
});

test('stopClickWriter() on an empty queue is a silent no-op', async () => {
  await cw.stopClickWriter();
  assert.equal(queries.length, 0, 'nothing written when there is nothing queued');
});
