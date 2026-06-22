import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db';
import { getCachedUrl, setCachedUrl, setTombstone } from '../cache';
import { detectWebview } from '../webview/detect';
import { buildAndroidEscapePage } from '../webview/android';
import { buildIosEscapePage } from '../webview/ios';
import { enqueueClick } from '../analytics/clickWriter';
import { hashIp, getCountry } from '../analytics/geoip';
import { parseUA } from '../analytics/ua';

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

/** Owner of the request, or null (populated by the global authenticate hook). */
function getOwnerId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).type('text/html; charset=utf-8').send(NOT_FOUND_HTML);
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
    enqueueClick({
      linkId: BigInt(id),
      createdAt: new Date(),
      ipHash: hashIp(request.ip),
      country: getCountry(request.ip),
      referer: (request.headers.referer as string) ?? '',
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

  let longUrl: string;
  let isPrivate = false;
  let prefer301 = false;
  let ownerId: string | null = null;
  let linkId: string | null = null;

  // Hot path: try Redis first.
  const cached = await getCachedUrl(code);
  if (cached) {
    if ('tombstone' in cached) {
      return notFound(reply);
    }
    // Cache holds only public 302 URLs → redirect with no DB work. (linkId is
    // unknown here; recordClick resolves it in the background.)
    longUrl = cached.url;
  } else {
    const pgPool = getPool();

    const lookup = await pgPool.query<{ link_id: string; created_at: Date }>(
      'SELECT link_id, created_at FROM links_code_lookup WHERE short_code = $1',
      [code],
    );
    if (lookup.rows.length === 0) {
      await setTombstone(code, 'NOT_FOUND');
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
      await setTombstone(code, 'NOT_FOUND');
      return notFound(reply);
    }

    const row = linkRes.rows[0];
    if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
      await setTombstone(code, 'EXPIRED');
      return notFound(reply);
    }

    longUrl = row.long_url;
    isPrivate = row.is_private;
    prefer301 = row.prefer_301;
    ownerId = row.owner_id;
    linkId = row.id;

    // Cache only public, analytics-on (302) links as servable URLs.
    if (!isPrivate && !prefer301) {
      await setCachedUrl(code, longUrl);
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
    recordClick(request, code, linkId, true, webview.network);
    const html = buildAndroidEscapePage(longUrl, webview.network ?? 'generic');
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
    return reply.redirect(longUrl, 301);
  }

  // 302 (default): not cacheable, analytics on — record click off the hot path.
  recordClick(request, code, linkId, false, webview.network);
  reply.header('Cache-Control', 'no-store');
  return reply.redirect(longUrl, 302);
}

export async function registerRedirectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/:code', handleRedirect);
}
