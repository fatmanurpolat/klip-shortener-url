import { timingSafeEqual } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
import { env } from '../env';
import { setTombstone } from '../cache';
import { ipPrefix } from '../security/ipPrefix';

/**
 * Internal admin API for abuse handling. Authenticated by a shared secret in the
 * X-Admin-Secret header (constant-time compared to ADMIN_SECRET). nginx also
 * blocks /admin/ from the public, so this is defense in depth.
 *
 * When ADMIN_SECRET is unset, every endpoint returns 503 (admin disabled).
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false; // length isn't secret
  return timingSafeEqual(ab, bb);
}

/** preHandler: 503 if admin not configured, 403 if the secret is wrong/missing. */
async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const secret = env.ADMIN_SECRET;
  if (!secret) {
    return reply.code(503).send({ error: 'admin_disabled', message: 'Admin API is not configured.' });
  }
  const header = request.headers['x-admin-secret'];
  const provided = (Array.isArray(header) ? header[0] : header) ?? '';
  if (!safeEqual(provided, secret)) {
    return reply.code(403).send({ error: 'forbidden' });
  }
}

// ---------------------------------------------------------------------------
// POST /admin/disable-link  { code, reason }
// ---------------------------------------------------------------------------
const disableSchema = z.object({
  code: z.string().min(1).max(64),
  reason: z.string().max(500).optional(),
});

async function handleDisableLink(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = disableSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'code is required.' });
  }
  const { code, reason } = parsed.data;
  const pool = getPool();

  // Resolve the partitioned link row (id, created_at) from the global lookup.
  const lookup = await pool.query<{ link_id: string; created_at: Date }>(
    'SELECT link_id, created_at FROM links_code_lookup WHERE short_code = $1',
    [code],
  );
  if (lookup.rows.length === 0) {
    return reply.code(404).send({ error: 'not_found', message: 'Link not found.' });
  }

  await pool.query(
    'UPDATE links SET is_disabled = TRUE, disabled_reason = $1 WHERE id = $2 AND created_at = $3',
    [reason ?? null, lookup.rows[0].link_id, lookup.rows[0].created_at],
  );

  // Write a DISABLED marker to Redis (not a plain DEL). This is part of the disable
  // contract: an ALREADY-cached link keeps 302-ing until its TTL unless the cache
  // is overwritten, and the marker also blocks an in-flight redirect from re-caching
  // the live URL (setCachedUrl refuses to clobber DISABLED). Because it's load-
  // bearing for abuse mitigation, we retry, and if it ultimately fails we tell the
  // operator rather than falsely reporting full success.
  let cacheMarked = false;
  for (let attempt = 0; attempt < 3 && !cacheMarked; attempt++) {
    try {
      await setTombstone(code, 'DISABLED');
      cacheMarked = true;
    } catch (err) {
      request.log.warn({ err, code, attempt }, 'admin: disable cache marker write failed');
    }
  }

  request.log.info({ code, reason, cacheMarked }, 'admin: link disabled');
  if (!cacheMarked) {
    // DB is updated (link is disabled), but Redis is unreachable. A previously
    // cached copy may keep redirecting until REDIS_URL_TTL — surface this so the
    // operator retries instead of believing the link is fully neutralized.
    return reply.code(200).send({
      ok: true,
      code,
      disabled: true,
      cacheMarked: false,
      warning:
        'Link disabled in the database, but the Redis cache marker could not be written. ' +
        'A previously cached copy may keep redirecting until it expires. Retry once Redis is reachable.',
    });
  }
  return reply.code(200).send({ ok: true, code, disabled: true, cacheMarked: true });
}

// ---------------------------------------------------------------------------
// POST /admin/block-domain  { domain, reason }
// ---------------------------------------------------------------------------
const blockSchema = z.object({
  domain: z.string().min(1).max(255),
  reason: z.string().max(500).optional(),
});

async function handleBlockDomain(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = blockSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'domain is required.' });
  }
  // Store lowercased; the shorten-time check (urlSafety) matches host or .host.
  const domain = parsed.data.domain.trim().toLowerCase();

  await getPool().query(
    `INSERT INTO blocked_domains (domain, reason) VALUES ($1, $2)
     ON CONFLICT (domain) DO UPDATE SET reason = EXCLUDED.reason`,
    [domain, parsed.data.reason ?? null],
  );

  request.log.info({ domain }, 'admin: domain blocked');
  // NOTE: blocking a domain only prevents FUTURE shortens of it. Existing links
  // pointing at this domain are NOT retroactively disabled — disable them
  // individually via /admin/disable-link if needed.
  return reply.code(200).send({
    ok: true,
    domain,
    note: 'Blocks future shortens only; existing links are not retroactively disabled.',
  });
}

// ---------------------------------------------------------------------------
// GET /admin/audit?code=&ip=&from=&to=
// ---------------------------------------------------------------------------
const auditQuerySchema = z.object({
  code: z.string().max(64).optional(),
  ip: z.string().max(64).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function handleAudit(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = auditQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid filters.' });
  }
  const { code, ip, from, to, limit } = parsed.data;

  const where: string[] = [];
  const params: unknown[] = [];
  if (code) {
    params.push(code);
    where.push(`short_code = $${params.length}`);
  }
  if (ip) {
    // Match the stored prefix. Accept either a prefix ("1.2.3.0/24") or a raw IP
    // (we derive its prefix). created_at is the partition key; from/to prune it.
    const prefix = ip.includes('/') ? ip : ipPrefix(ip);
    params.push(prefix);
    where.push(`ip_prefix = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`created_at < $${params.length}::timestamptz`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(limit);

  const res = await getPool().query(
    `SELECT id, short_code, long_url, owner_id, ip_prefix, created_at
       FROM shorten_audit
       ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params,
  );

  return reply.code(200).send({
    count: res.rows.length,
    rows: res.rows.map((r) => ({
      id: String(r.id),
      shortCode: r.short_code,
      longUrl: r.long_url,
      ownerId: r.owner_id,
      ipPrefix: r.ip_prefix,
      createdAt: (r.created_at as Date).toISOString(),
    })),
  });
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/admin/disable-link', { preHandler: requireAdmin }, handleDisableLink);
  app.post('/admin/block-domain', { preHandler: requireAdmin }, handleBlockDomain);
  app.get('/admin/audit', { preHandler: requireAdmin }, handleAudit);
}
