import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPool } from '../db';
import { requireAuth } from '../middleware/authenticate';

/**
 * GET /api/v1/links/:code/stats — aggregated click analytics for one link.
 * Owner-only. 301 links report analytics: false (clicks bypass the server).
 */

function toDayString(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

interface LinkRow {
  id: string;
  owner_id: string | null;
  prefer_301: boolean;
}

async function handleStats(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const user = request.user;
  if (!user) {
    return reply.code(401).send({ error: 'auth_required' });
  }

  const { code } = request.params as { code: string };
  const query = request.query as { from?: string; to?: string };

  // Date range: default last 30 days .. today (inclusive).
  const now = new Date();
  let toDate = now;
  let fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (query.to !== undefined) {
    const d = new Date(query.to);
    if (Number.isNaN(d.getTime())) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid "to" date.' });
    }
    toDate = d;
  }
  if (query.from !== undefined) {
    const d = new Date(query.from);
    if (Number.isNaN(d.getTime())) {
      return reply.code(400).send({ error: 'validation_error', message: 'Invalid "from" date.' });
    }
    fromDate = d;
  }
  const from = toDayString(fromDate);
  const to = toDayString(toDate);

  const pool = getPool();

  // 1. Resolve the link (partition-pruned join).
  const linkRes = await pool.query<LinkRow>(
    `SELECT l.id, l.owner_id, l.prefer_301
       FROM links_code_lookup lcl
       JOIN links l ON l.id = lcl.link_id AND l.created_at = lcl.created_at
      WHERE lcl.short_code = $1`,
    [code],
  );
  if (linkRes.rows.length === 0) {
    return reply.code(404).send({ error: 'not_found', message: 'Link not found.' });
  }
  const link = linkRes.rows[0];

  // 2. Owner-only.
  if (link.owner_id !== user.userId) {
    return reply.code(403).send({ error: 'forbidden', message: 'You do not own this link.' });
  }

  // 3. 301 links don't produce analytics.
  if (link.prefer_301) {
    return reply.code(200).send({
      code,
      analytics: false,
      message:
        'This link uses 301 redirects. Analytics are not available because browsers cache the destination and subsequent clicks bypass the server.',
    });
  }

  const id = link.id;
  const params = [id, from, to];

  // Run the aggregations in parallel.
  const [totals, byDayRes, referrersRes, countryRes, deviceRes, networkRes] = await Promise.all([
    // 4. Totals + uniques (raw clicks).
    pool.query<{ total: number; uniq: number }>(
      `SELECT COUNT(*)::int AS total, COUNT(DISTINCT ip_hash)::int AS uniq
         FROM clicks
        WHERE link_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
      params,
    ),
    // 5. By day (rollup).
    pool.query<{ date: string; clicks: string }>(
      `SELECT day::text AS date, SUM(clicks)::bigint AS clicks
         FROM clicks_daily
        WHERE link_id = $1 AND day >= $2::date AND day <= $3::date
        GROUP BY day ORDER BY day ASC`,
      params,
    ),
    // 6. Top referrers (raw clicks).
    pool.query<{ referer: string | null; clicks: number }>(
      `SELECT referer, COUNT(*)::int AS clicks
         FROM clicks
        WHERE link_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
        GROUP BY referer ORDER BY clicks DESC LIMIT 10`,
      params,
    ),
    // 7. By country (rollup).
    pool.query<{ country: string | null; clicks: string }>(
      `SELECT country, SUM(clicks)::bigint AS clicks
         FROM clicks_daily
        WHERE link_id = $1 AND day >= $2::date AND day <= $3::date
        GROUP BY country ORDER BY clicks DESC`,
      params,
    ),
    // 8. By device + webview split (raw clicks).
    pool.query<{ ua_device: string | null; is_webview: boolean; clicks: number }>(
      `SELECT ua_device, is_webview, COUNT(*)::int AS clicks
         FROM clicks
        WHERE link_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
        GROUP BY ua_device, is_webview`,
      params,
    ),
    // 9. Webview by network (raw clicks).
    pool.query<{ network: string; clicks: number }>(
      `SELECT COALESCE(ua_network, 'generic') AS network, COUNT(*)::int AS clicks
         FROM clicks
        WHERE link_id = $1 AND is_webview = true
          AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
        GROUP BY COALESCE(ua_network, 'generic') ORDER BY clicks DESC`,
      params,
    ),
  ]);

  // Derive byDevice + webview/native split from query 8.
  const deviceMap = new Map<string, number>();
  let webview = 0;
  let native = 0;
  for (const row of deviceRes.rows) {
    const device = row.ua_device ?? '';
    deviceMap.set(device, (deviceMap.get(device) ?? 0) + row.clicks);
    if (row.is_webview) webview += row.clicks;
    else native += row.clicks;
  }
  const byDevice = [...deviceMap.entries()]
    .map(([device, clicks]) => ({ device, clicks }))
    .sort((a, b) => b.clicks - a.clicks);

  const response: Record<string, unknown> = {
    code,
    totalClicks: totals.rows[0].total,
    uniqueClicks: totals.rows[0].uniq,
    byDay: byDayRes.rows.map((r) => ({ date: r.date, clicks: Number(r.clicks) })),
    topReferrers: referrersRes.rows.map((r) => ({ referrer: r.referer ?? '', clicks: r.clicks })),
    byCountry: countryRes.rows.map((r) => ({ country: r.country ?? '', clicks: Number(r.clicks) })),
    byDevice,
    webviewVsNative: { webview, native },
  };

  // Only include the network breakdown when there were webview clicks.
  if (webview > 0) {
    response.webviewByNetwork = networkRes.rows.map((r) => ({ network: r.network, clicks: r.clicks }));
  }

  return reply.code(200).send(response);
}

export async function registerStatsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/links/:code/stats', { preHandler: requireAuth }, handleStats);
}
