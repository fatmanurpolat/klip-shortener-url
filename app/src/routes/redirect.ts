import { FastifyInstance, FastifyReply, FastifyRequest, FastifyBaseLogger } from 'fastify';
import { getPool, getRedis } from '../db';
import { env } from '../env';
import { detectWebview } from '../webview/detect';
import { buildAndroidEscapePage } from '../webview/android';

/**
 * GET /:code — resolve a short code to its destination and redirect.
 *
 * Hot path, optimized for latency:
 *   - One Redis GET resolves the common case with zero DB work.
 *   - Only PUBLIC, analytics-on (302) links are cached as plain URLs, so a
 *     cache hit is always a public 302 — no auth/expiry re-check needed.
 *     Private links are never cached (would bypass auth); 301 links are cached
 *     by browsers/CDN via max-age and don't need Redis.
 *   - Negative results are cached as short-lived tombstones to absorb floods.
 *   - Click tracking is fire-and-forget (never awaited).
 */

const TOMBSTONES = new Set(['NOT_FOUND', 'EXPIRED', 'DELETED']);
const TOMBSTONE_TTL = 60; // seconds

const keyFor = (code: string): string => `klip:url:${code}`;

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Link not found — Klip</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
       background:linear-gradient(135deg,#fffafc,#fdf2fb 45%,#eef3ff);color:#5b4a6b}
  .box{text-align:center;padding:2rem}
  h1{font-size:3rem;margin:0;background:linear-gradient(100deg,#ff7eb6,#9d7bff);
     -webkit-background-clip:text;background-clip:text;color:transparent}
  p{opacity:.8}
</style></head>
<body><div class="box"><h1>🌷</h1><h2>Link not found or expired</h2>
<p>This Klip doesn't exist anymore.</p></div></body></html>`;

interface LinkRow {
  id: string;
  long_url: string;
  expires_at: Date | null;
  is_private: boolean;
  prefer_301: boolean;
  owner_id: string | null;
}

interface ClickEvent {
  code: string;
  linkId: string | null;
  ts: number;
  ua: string;
  referer: string | null;
  ip: string;
  isWebview: boolean;
}

/** Owner of the request, or null (populated by the global authenticate hook). */
function getOwnerId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND_HTML);
}

// -----------------------------------------------------------------------------
// Fire-and-forget click queue. Off the hot path via setImmediate; the worker is
// a STUB that logs at debug level (P1 batch-inserts into clicks/clicks_daily).
// -----------------------------------------------------------------------------
const clickQueue: ClickEvent[] = [];
let draining = false;

function enqueueClick(event: ClickEvent, log: FastifyBaseLogger): void {
  clickQueue.push(event);
  if (!draining) {
    draining = true;
    setImmediate(drainClicks, log);
  }
}

function drainClicks(log: FastifyBaseLogger): void {
  const batch = clickQueue.splice(0, clickQueue.length);
  for (const event of batch) {
    log.debug({ click: event }, 'click event (stub worker)');
  }
  draining = false;
}

function makeClick(
  code: string,
  linkId: string | null,
  ua: string,
  request: FastifyRequest,
  webview: boolean,
): ClickEvent {
  return {
    code,
    linkId,
    ts: Date.now(),
    ua,
    referer: (request.headers.referer as string) ?? null,
    ip: request.ip,
    isWebview: webview,
  };
}

async function handleRedirect(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const { code } = request.params as { code: string };
  const redisClient = getRedis();
  const key = keyFor(code);

  let longUrl: string;
  let isPrivate = false;
  let prefer301 = false;
  let ownerId: string | null = null;
  let linkId: string | null = null;

  const cached = await redisClient.get(key);
  if (cached !== null) {
    if (TOMBSTONES.has(cached)) {
      return notFound(reply);
    }
    // Cache holds only public 302 links, so we can redirect with no DB work.
    longUrl = cached;
  } else {
    const pgPool = getPool();

    const lookup = await pgPool.query<{ link_id: string; created_at: Date }>(
      'SELECT link_id, created_at FROM links_code_lookup WHERE short_code = $1',
      [code],
    );
    if (lookup.rows.length === 0) {
      await redisClient.set(key, 'NOT_FOUND', 'EX', TOMBSTONE_TTL);
      return notFound(reply);
    }

    // Partition-pruned read: both PK columns supplied.
    const linkRes = await pgPool.query<LinkRow>(
      `SELECT id, long_url, expires_at, is_private, prefer_301, owner_id
         FROM links
        WHERE id = $1 AND created_at = $2`,
      [lookup.rows[0].link_id, lookup.rows[0].created_at],
    );
    if (linkRes.rows.length === 0) {
      await redisClient.set(key, 'NOT_FOUND', 'EX', TOMBSTONE_TTL);
      return notFound(reply);
    }

    const row = linkRes.rows[0];
    if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
      await redisClient.set(key, 'EXPIRED', 'EX', TOMBSTONE_TTL);
      return notFound(reply);
    }

    longUrl = row.long_url;
    isPrivate = row.is_private;
    prefer301 = row.prefer_301;
    ownerId = row.owner_id;
    linkId = row.id;

    // Repopulate cache only for public 302 links (see module note).
    if (!isPrivate && !prefer301) {
      await redisClient.set(key, longUrl, 'EX', env.REDIS_URL_TTL);
    }
  }

  // Private links require the owner; otherwise 404 (never confirm existence).
  if (isPrivate) {
    const requester = getOwnerId(request);
    if (!requester || requester !== ownerId) {
      return notFound(reply);
    }
  }

  const ua = (request.headers['user-agent'] as string) ?? '';
  const webview = detectWebview(ua);

  // Android in-app browser → serve the Chrome-intent escape page (200 HTML),
  // not a redirect. Record the click (is_webview) off the hot path.
  if (webview.isWebview && webview.platform === 'android') {
    enqueueClick(makeClick(code, linkId, ua, request, true), request.log);
    const html = buildAndroidEscapePage(longUrl, webview.network ?? 'generic');
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(html);
  }
  // iOS / other webviews fall through to a normal redirect for now (the iOS
  // escape is handled in a later phase).

  // 301: cacheable, analytics off — no click tracking.
  if (prefer301) {
    reply.header('Cache-Control', 'public, max-age=31536000');
    return reply.redirect(longUrl, 301);
  }

  // 302 (default): not cacheable, analytics on — enqueue click, don't await.
  enqueueClick(makeClick(code, linkId, ua, request, false), request.log);
  reply.header('Cache-Control', 'no-store');
  return reply.redirect(longUrl, 302);
}

export async function registerRedirectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:code', handleRedirect);
}
