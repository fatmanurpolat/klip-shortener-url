import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db';
import { getCachedUrl, setCachedUrl, setTombstone } from '../cache';
import { detectWebview } from '../webview/detect';
import { buildAndroidEscapePage } from '../webview/android';
import { buildIosEscapePage } from '../webview/ios';
import { enqueueClick } from '../analytics/clickWriter';
import { hashIp, getCountry } from '../analytics/geoip';
import { parseUA } from '../analytics/ua';
import { rateLimit, getClientIp } from '../security/rateLimit';
import { performance } from 'node:perf_hooks';
import { redirectsTotal, cacheHits, redirectDuration } from '../metrics';

type RedirectType = '301' | '302' | 'interstitial' | '404' | 'disabled';

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

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Link not found — Klipo</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
       background:linear-gradient(135deg,#fffafc,#fdf2fb 45%,#eef3ff);color:#5b4a6b}
  .box{text-align:center;padding:2rem}
  h1{font-size:3rem;margin:0;background:linear-gradient(100deg,#ff7eb6,#9d7bff);
     -webkit-background-clip:text;background-clip:text;color:transparent}
  p{opacity:.8}
</style></head>
<body><div class="box"><h1>🌷</h1><h2>Link not found or expired</h2>
<p>This Klipo doesn't exist anymore.</p></div></body></html>`;

interface LinkRow {
  id: string;
  long_url: string;
  expires_at: Date | null;
  is_private: boolean;
  prefer_301: boolean;
  owner_id: string | null;
  is_disabled: boolean;
}

/** Owner of the request, or null (populated by the global authenticate hook). */
function getOwnerId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND_HTML);
}

const DISABLED_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Link disabled — Klipo</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;
       background:linear-gradient(135deg,#fffafc,#fdf2fb 45%,#eef3ff);color:#5b4a6b}
  .box{text-align:center;padding:2rem;max-width:28rem}
  h1{font-size:3rem;margin:0}
  h2{margin:.5rem 0}
  p{opacity:.8}
</style></head>
<body><div class="box"><h1>🚫</h1><h2>This link has been disabled</h2>
<p>This short link was turned off and no longer forwards anywhere.</p></div></body></html>`;

// 200 (not a redirect): the link exists but is disabled. No analytics, no cache.
function disabledPage(reply: FastifyReply): FastifyReply {
  return reply
    .code(200)
    .type('text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send(DISABLED_HTML);
}

// Off the hot path (setImmediate): record a click. On a cache hit the link id
// isn't known, so we resolve it from the lookup table here — after the response
// is already sent — keeping the redirect response itself SQL-free.
function recordClick(
  request: FastifyRequest,
  code: string,
  linkId: string | null,
  isWebview: boolean,
  network: string | null,
): void {
  setImmediate(async () => {
    let id = linkId;
    if (id === null) {
      try {
        const res = await getPool().query<{ link_id: string }>(
          'SELECT link_id FROM links_code_lookup WHERE short_code = $1',
          [code],
        );
        id = res.rows[0]?.link_id ?? null;
      } catch {
        id = null;
      }
    }
    if (id === null) return;

    const ua = parseUA((request.headers['user-agent'] as string) ?? '');
    // Use the proxy-attested client IP (same source as the rate limiter), not the
    // spoofable left-most req.ip, so forged X-Forwarded-For can't poison analytics.
    const clientIp = getClientIp(request);
    enqueueClick({
      linkId: BigInt(id),
      createdAt: new Date(),
      ipHash: hashIp(clientIp),
      country: getCountry(clientIp),
      // Truncate the attacker-controlled Referer before it's persisted to the
      // partitioned clicks table (prevents row bloat from a giant header).
      referer: ((request.headers.referer as string) ?? '').slice(0, 512),
      uaBrowser: ua.browser,
      uaOs: ua.os,
      uaDevice: ua.device,
      uaNetwork: network,
      isWebview,
    });
  });
}

async function handleRedirect(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const { code } = request.params as { code: string };

  // Redis writes below are optimizations; a Redis outage must not take down
  // redirects (the rate limiter already fails open for this surface). Cache
  // writes are best-effort and the read degrades to the Postgres path.
  const cacheWrite = (p: Promise<unknown>): Promise<unknown> =>
    p.catch((err) => request.log.warn({ err, code }, 'redirect: Redis cache write failed (non-fatal)'));

  // Latency + per-stage timing for the metrics histogram and the structured log.
  const t0 = performance.now();
  let redisMs = 0;
  let dbMs = 0;
  let cacheHit = false;

  let longUrl = '';
  let isPrivate = false;
  let prefer301 = false;
  let isDisabled = false;
  let ownerId: string | null = null;
  let linkId: string | null = null;

  // Detect the webview up front (cheap regex, run once) so it's available for the
  // structured log on every exit — not just the interstitial paths.
  const ua = (request.headers['user-agent'] as string) ?? '';
  const webview = detectWebview(ua);

  // Emit the histogram + counter + one structured `redirect` log line. Called
  // exactly once, just before each response is returned. Only the destination
  // HOSTNAME is logged (no path/query) for privacy.
  const finish = (type: RedirectType, status: number): void => {
    redirectDuration.observe((performance.now() - t0) / 1000);
    redirectsTotal.inc({ status: String(status), type });
    let longUrlDomain = '';
    if (longUrl) {
      try {
        longUrlDomain = new URL(longUrl).hostname;
      } catch {
        /* unparseable — leave blank */
      }
    }
    request.log.info(
      {
        short_code: code,
        redirect_type: type,
        is_webview: webview.isWebview,
        webview_network: webview.network ?? null,
        cache_hit: cacheHit,
        db_ms: Math.round(dbMs * 1000) / 1000,
        redis_ms: Math.round(redisMs * 1000) / 1000,
        long_url_domain: longUrlDomain,
      },
      'redirect',
    );
  };

  // Hot path: try Redis first; on a Redis read error, fall through to Postgres.
  let cached: Awaited<ReturnType<typeof getCachedUrl>> = null;
  const r0 = performance.now();
  try {
    cached = await getCachedUrl(code);
  } catch (err) {
    request.log.warn({ err, code }, 'redirect: Redis read failed — falling back to Postgres');
  }
  redisMs = performance.now() - r0;
  cacheHit = cached !== null;
  cacheHits.inc({ result: cached === null ? 'miss' : 'tombstone' in cached ? 'tombstone' : 'hit' });

  if (cached) {
    if ('tombstone' in cached) {
      // A DISABLED marker means the link exists but was turned off by an admin →
      // serve the 200 disabled page, never a 404. EXPIRED/DELETED/NOT_FOUND are
      // genuine negatives → 404. (Either way, zero DB work.)
      if (cached.tombstone === 'DISABLED') {
        finish('disabled', 200);
        return disabledPage(reply);
      }
      finish('404', 404);
      return notFound(reply);
    }
    // Cache holds only public 302 URLs → redirect with no DB work. (linkId is
    // unknown here; recordClick resolves it in the background.)
    longUrl = cached.url;
  } else {
    const pgPool = getPool();
    const d0 = performance.now();

    const lookup = await pgPool.query<{ link_id: string; created_at: Date }>(
      'SELECT link_id, created_at FROM links_code_lookup WHERE short_code = $1',
      [code],
    );
    if (lookup.rows.length === 0) {
      dbMs = performance.now() - d0;
      await cacheWrite(setTombstone(code, 'NOT_FOUND'));
      finish('404', 404);
      return notFound(reply);
    }

    // Partition-pruned read: both PK columns supplied.
    const linkRes = await pgPool.query<LinkRow>(
      `SELECT id, long_url, expires_at, is_private, prefer_301, owner_id, is_disabled
         FROM links
        WHERE id = $1 AND created_at = $2`,
      [lookup.rows[0].link_id, lookup.rows[0].created_at],
    );
    if (linkRes.rows.length === 0) {
      dbMs = performance.now() - d0;
      await cacheWrite(setTombstone(code, 'NOT_FOUND'));
      finish('404', 404);
      return notFound(reply);
    }

    const row = linkRes.rows[0];
    if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
      dbMs = performance.now() - d0;
      await cacheWrite(setTombstone(code, 'EXPIRED'));
      finish('404', 404);
      return notFound(reply);
    }
    dbMs = performance.now() - d0;

    longUrl = row.long_url;
    isPrivate = row.is_private;
    prefer301 = row.prefer_301;
    isDisabled = row.is_disabled;
    ownerId = row.owner_id;
    linkId = row.id;

    // Cache only public, analytics-on (302) links that are NOT disabled, so a
    // cache hit always means a live, servable link. If an admin disables this link
    // concurrently (after our DB read but before this write), setCachedUrl is a
    // no-op against the DISABLED marker — the marker can't be clobbered here.
    if (!isPrivate && !prefer301 && !isDisabled) {
      await cacheWrite(setCachedUrl(code, longUrl));
    }
  }

  // Private links require the owner; otherwise 404 (never confirm existence).
  if (isPrivate) {
    const requester = getOwnerId(request);
    if (!requester || requester !== ownerId) {
      finish('404', 404);
      return notFound(reply);
    }
  }

  // Disabled by an admin → serve the disabled page (200), no redirect, no
  // analytics. Write a DISABLED marker so subsequent hits short-circuit in Redis
  // without a DB round-trip, and so a concurrent in-flight redirect cannot
  // re-cache the live URL over us (setCachedUrl refuses to overwrite DISABLED).
  if (isDisabled) {
    await cacheWrite(setTombstone(code, 'DISABLED'));
    finish('disabled', 200);
    return disabledPage(reply);
  }

  // Android in-app browser → serve the Chrome-intent escape page (200 HTML),
  // not a redirect. Record the click (is_webview) off the hot path.
  if (webview.isWebview && webview.platform === 'android') {
    recordClick(request, code, linkId, true, webview.network);
    const html = buildAndroidEscapePage(longUrl, webview.network ?? 'generic');
    finish('interstitial', 200);
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(html);
  }
  // iOS in-app browser → serve the Safari-escape interstitial (200 HTML).
  if (webview.isWebview && webview.platform === 'ios') {
    recordClick(request, code, linkId, true, webview.network);
    const html = buildIosEscapePage(longUrl, webview.network ?? 'generic');
    finish('interstitial', 200);
    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(html);
  }
  // Non-webview (or webview on another platform) → normal redirect below.

  // 301: cacheable, analytics off — no click tracking.
  if (prefer301) {
    reply.header('Cache-Control', 'public, max-age=31536000');
    finish('301', 301);
    return reply.redirect(longUrl, 301);
  }

  // 302 (default): not cacheable, analytics on — record click off the hot path.
  recordClick(request, code, linkId, false, webview.network);
  reply.header('Cache-Control', 'no-store');
  finish('302', 302);
  return reply.redirect(longUrl, 302);
}

export async function registerRedirectRoutes(app: FastifyInstance): Promise<void> {
  // Redirect hot path: 600/min per IP, and FAIL OPEN if Redis is down (a Redis
  // outage must not take down redirects, which are the product's core function).
  app.get('/:code', { preHandler: rateLimit('redirect', 600) }, handleRedirect);
}
