import type { FastifyBaseLogger } from 'fastify';
import { getPool } from '../db';
import { clickQueueDepth } from '../metrics';

/**
 * Non-blocking click recorder. Redirects enqueue events synchronously (never
 * awaited, never throwing); a background interval batch-writes them to Postgres
 * every few seconds. Losing a few clicks on DB error is acceptable; blocking a
 * redirect is not.
 */

export type ClickEvent = {
  linkId: bigint;
  createdAt: Date;
  ipHash: Buffer;
  country: string;
  referer: string;
  uaBrowser: string;
  uaOs: string;
  uaDevice: string;
  uaNetwork: string | null; // webview network, or null for non-webview
  isWebview: boolean;
};

const FLUSH_INTERVAL_MS = 2000;

let queue: ClickEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
let logError: (err: unknown, dropped: number) => void = (err, dropped) =>
  console.error(`clickWriter: batch write failed, discarding ${dropped} clicks`, err);

/** Add a click to the queue. Never throws, never awaits. */
export function enqueueClick(event: ClickEvent): void {
  try {
    queue.push(event);
    clickQueueDepth.set(queue.length);
  } catch {
    // Swallow — recording analytics must never break a redirect.
  }
}

/** Start the background flush interval. Idempotent; call once on startup. */
export function initClickWriter(log?: FastifyBaseLogger): void {
  if (log) {
    logError = (err, dropped) =>
      log.error({ err, dropped }, 'clickWriter: batch write failed, discarding');
  }
  if (timer) return;
  timer = setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for the flush timer.
  timer.unref();
}

/**
 * Stop the flush interval and drain the queue ONE LAST TIME. Call on shutdown
 * (before the DB pool closes) so a graceful stop — including a scale-down or
 * rolling deploy of a replica — doesn't silently drop up to FLUSH_INTERVAL_MS of
 * queued clicks. Idempotent and never throws (flush swallows its own errors).
 */
export async function stopClickWriter(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  // Drain to a quiescent state before the pool closes. Three things can be in
  // flight at shutdown, and all must settle or their clicks are lost:
  //   1. A periodic flush whose writeBatch is mid-transaction — `flush()` is
  //      coalesced, so this await returns that SAME in-flight promise and we wait
  //      for its COMMIT instead of racing closeDb()/process.exit() (the bug this
  //      fixes: a fire-and-forget `void flush()` was getting cut off mid-write).
  //   2. setImmediate(recordClick / audit) callbacks queued but not yet run — the
  //      yield lets every already-scheduled one run (FIFO) and enqueue.
  //   3. Whatever those callbacks just enqueued — the final flush writes it.
  await flush();
  await new Promise((resolve) => setImmediate(resolve));
  await flush();
}

// Coalesced flush: concurrent callers (the interval + a shutdown drain) share one
// in-flight write rather than each swapping the queue independently. This is what
// lets stopClickWriter AWAIT a periodic flush that's already mid-transaction.
let pendingFlush: Promise<void> | null = null;

function flush(): Promise<void> {
  if (!pendingFlush) {
    pendingFlush = doFlush().finally(() => {
      pendingFlush = null;
    });
  }
  return pendingFlush;
}

async function doFlush(): Promise<void> {
  if (queue.length === 0) return;
  // Atomic swap: new enqueues land in a fresh array while we write this batch.
  const batch = queue;
  queue = [];
  clickQueueDepth.set(0);
  try {
    await writeBatch(batch);
  } catch (err) {
    logError(err, batch.length); // discard — do not re-queue
  }
}

async function writeBatch(batch: ClickEvent[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) One multi-row INSERT into the (partitioned) clicks table.
    const COLS = 10;
    const rows: string[] = [];
    const values: unknown[] = [];
    batch.forEach((e, i) => {
      const b = i * COLS;
      const ph = Array.from({ length: COLS }, (_, k) => `$${b + k + 1}`).join(',');
      rows.push(`(${ph})`);
      values.push(
        e.linkId.toString(), // bigint → text (node-postgres can't serialize BigInt)
        e.createdAt,
        e.ipHash,
        e.country,
        e.referer,
        e.uaBrowser,
        e.uaOs,
        e.uaDevice,
        e.uaNetwork,
        e.isWebview,
      );
    });
    await client.query(
      `INSERT INTO clicks
         (link_id, created_at, ip_hash, country, referer, ua_browser, ua_os, ua_device, ua_network, is_webview)
       VALUES ${rows.join(',')}`,
      values,
    );

    // 2) Aggregate per (link_id, day, country), then batch UPSERT the rollup.
    const daily = new Map<string, { linkId: string; day: string; country: string; clicks: number }>();
    for (const e of batch) {
      const linkId = e.linkId.toString();
      const day = e.createdAt.toISOString().slice(0, 10);
      const country = e.country ?? '';
      const key = `${linkId}|${day}|${country}`;
      const existing = daily.get(key);
      if (existing) existing.clicks += 1;
      else daily.set(key, { linkId, day, country, clicks: 1 });
    }

    const dRows: string[] = [];
    const dValues: unknown[] = [];
    let i = 0;
    for (const d of daily.values()) {
      const b = i * 4;
      dRows.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      dValues.push(d.linkId, d.day, d.country, d.clicks);
      i += 1;
    }
    await client.query(
      `INSERT INTO clicks_daily (link_id, day, country, clicks)
       VALUES ${dRows.join(',')}
       ON CONFLICT (link_id, day, country)
       DO UPDATE SET clicks = clicks_daily.clicks + excluded.clicks`,
      dValues,
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
