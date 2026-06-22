import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getNextId } from '../counter';
import { mintCode, COUNTER_OFFSET } from '../codes';
import { getPool, getRedis } from '../db';
import { env } from '../env';

/**
 * POST /api/v1/shorten — mint a short code and persist a link.
 *
 * Write path: validate → (auth gate for private) → allocate a unique ID →
 * persist link + code lookup in ONE explicit transaction (BEGIN/COMMIT) →
 * best-effort cache → 201. The commit is what makes the rows visible to
 * other connections (e.g. DBeaver) the instant the request returns.
 */

const RESERVED_WORDS = new Set([
  'api', 'v1', 'admin', 'login', 'signup', 'logout', 'dashboard', 'settings',
  'account', 'health', 'healthz', 'assets', 'static', 'favicon.ico', 'robots.txt',
]);

const ALIAS_RE = /^[0-9A-Za-z_-]{3,32}$/;

const bodySchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), 'only http/https allowed'),
  customAlias: z.string().regex(ALIAS_RE).optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .refine((v) => !v || new Date(v) > new Date(), 'must be in the future'),
  private: z.boolean().default(false),
  analytics: z.boolean().default(true), // false → prefer_301 = true in DB
});

/**
 * Owner of the link, or null for anonymous requests. Populated by the auth
 * preHandler (token verification) once that lands; until then every request
 * is anonymous, so `private: true` always yields 401 — which is correct.
 */
function getOwnerId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

/** Map a Zod failure to the specific error contract this endpoint promises. */
function sendValidationError(error: z.ZodError, reply: FastifyReply): FastifyReply {
  const issues = error.issues;

  const urlIssue = issues.find((i) => i.path[0] === 'url');
  if (urlIssue) {
    return reply.code(400).send({ error: 'invalid_url', message: urlIssue.message });
  }

  // The .refine on expiresAt produces a `custom` issue → expiry in the past.
  const pastExpiry = issues.find((i) => i.path[0] === 'expiresAt' && i.code === 'custom');
  if (pastExpiry) {
    return reply.code(422).send({ error: 'invalid_expiry', message: pastExpiry.message });
  }

  const first = issues[0];
  return reply.code(400).send({
    error: 'validation_error',
    message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body',
  });
}

async function handleShorten(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // 1. Validate the body strictly with Zod.
  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(parsed.error, reply);
  }
  const body = parsed.data;

  // Auth gate: private links require an authenticated owner (401 otherwise).
  const ownerId = getOwnerId(request);
  if (body.private && !ownerId) {
    return reply.code(401).send({ error: 'auth_required', message: 'Sign in to create a private link.' });
  }

  // Reserved alias check (400).
  if (body.customAlias && RESERVED_WORDS.has(body.customAlias.toLowerCase())) {
    return reply
      .code(400)
      .send({ error: 'reserved_alias', message: 'This alias is reserved and cannot be used.' });
  }

  // 2-3. Allocate a unique ID and derive the short code. Custom aliases also
  // consume a real ID so link_id uniquely identifies one links row.
  let seq: bigint;
  try {
    seq = await getNextId();
  } catch (err) {
    request.log.error({ err }, 'shorten: ID counter unavailable');
    return reply
      .code(503)
      .send({ error: 'counter_unavailable', message: 'Could not allocate an ID, please retry.' });
  }
  const id = (seq + COUNTER_OFFSET).toString(); // BIGINT param sent as text
  const shortCode = body.customAlias ?? mintCode(seq);

  // The shared node-postgres pool and ioredis client from src/db.ts.
  const pgPool = getPool();
  const redisClient = getRedis();

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // Insert the global code lookup first: this atomically detects alias
    // collisions (ON CONFLICT DO NOTHING) before we touch the partitioned
    // links table, and its created_at is reused so both tables align exactly
    // for partition routing on the read path.
    const lookupSql = body.customAlias
      ? `INSERT INTO links_code_lookup (short_code, link_id, created_at)
         VALUES ($1, $2, now())
         ON CONFLICT (short_code) DO NOTHING
         RETURNING created_at`
      : `INSERT INTO links_code_lookup (short_code, link_id, created_at)
         VALUES ($1, $2, now())
         RETURNING created_at`;
    const lookup = await client.query<{ created_at: Date }>(lookupSql, [shortCode, id]);

    if (lookup.rows.length === 0) {
      // Only reachable on the alias path (a fresh unique code can't conflict).
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'alias_taken', message: 'This alias is already in use.' });
    }
    const createdAt = lookup.rows[0].created_at;

    await client.query(
      `INSERT INTO links
         (id, short_code, long_url, owner_id, is_private, prefer_301, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, shortCode, body.url, ownerId, body.private, !body.analytics, body.expiresAt ?? null, createdAt],
    );

    // Explicit commit — data is durable and visible to other clients now.
    await client.query('COMMIT');

    // 4. Best-effort cache. The redirect path falls back to the DB on a miss,
    // so a Redis hiccup must not fail link creation.
    try {
      await redisClient.set(`klip:url:${shortCode}`, body.url, 'EX', env.REDIS_URL_TTL);
    } catch (err) {
      request.log.warn({ err, shortCode }, 'shorten: redis cache write failed (non-fatal)');
    }

    // 7. Success.
    return reply.code(201).send({
      shortUrl: `https://${env.SHORT_DOMAIN}/${shortCode}`,
      code: shortCode,
      longUrl: body.url,
      createdAt: createdAt.toISOString(),
      expiresAt: body.expiresAt ?? null,
      private: body.private,
      analytics: body.analytics,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    request.log.error({ err }, 'shorten: failed to persist link');
    return reply.code(500).send({ error: 'internal_error', message: 'Could not create the short link.' });
  } finally {
    client.release();
  }
}

export async function registerShortenRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/shorten', handleShorten);
}
