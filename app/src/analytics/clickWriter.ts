import type { FastifyBaseLogger } from 'fastify';
import { getPool } from '../db';

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

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  // Atomic swap: new enqueues land in a fresh array while we write this batch.
  const batch = queue;
  queue = [];
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
    const COLS = 9;
    const rows: string[] = [];
    const values: unknown[] = [];
    batch.forEach((e, i) => {
      const b = i * COLS;
      rows.push(
        `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`,
      );
      values.push(
        e.linkId.toString(), // bigint → text (node-postgres can't serialize BigInt)
        e.createdAt,
        e.ipHash,
        e.country,
        e.referer,
        e.uaBrowser,
        e.uaOs,
        e.uaDevice,
        e.isWebview,
      );
    });
    await client.query(
      `INSERT INTO clicks
         (link_id, created_at, ip_hash, country, referer, ua_browser, ua_os, ua_device, is_webview)
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
