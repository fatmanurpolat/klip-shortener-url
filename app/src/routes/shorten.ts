import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getNextId } from '../counter';
import { mintCode, COUNTER_OFFSET } from '../codes';
import { getPool } from '../db';
import { env } from '../env';
import { setCachedUrl, checkRateLimit } from '../cache';
import { validateUrl, UrlSafetyError, type UrlSafetyCode } from '../security/urlSafety';

// Per-IP rate limit for link creation.
const SHORTEN_RATE_LIMIT = 20;
const SHORTEN_RATE_WINDOW = 60; // seconds

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

// HTTP status per URL-safety failure. Client-input problems are 400; a URL that
// is well-formed but disallowed (blocked domain / known-malicious) is 422.
const URL_SAFETY_STATUS: Record<UrlSafetyCode, number> = {
  INVALID_SCHEME: 400,
  PRIVATE_HOST: 400,
  UNRESOLVABLE_HOST: 400,
  SELF_REFERENTIAL: 400,
  BLOCKED_DOMAIN: 422,
  MALICIOUS_URL: 422,
};

// `error` field for each code. The 422s share "unsafe_url" per the API contract.
const URL_SAFETY_ERROR_FIELD: Record<UrlSafetyCode, string> = {
  INVALID_SCHEME: 'invalid_url',
  PRIVATE_HOST: 'blocked_host',
  UNRESOLVABLE_HOST: 'unresolvable_host',
  SELF_REFERENTIAL: 'self_referential',
  BLOCKED_DOMAIN: 'unsafe_url',
  MALICIOUS_URL: 'unsafe_url',
};

/** Map a URL-safety failure to its HTTP response. */
function sendUrlSafetyError(err: UrlSafetyError, reply: FastifyReply): FastifyReply {
  return reply
    .code(URL_SAFETY_STATUS[err.code])
    .send({ error: URL_SAFETY_ERROR_FIELD[err.code], message: err.message });
}

async function handleShorten(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Rate limit per client IP before doing any work.
  const rl = await checkRateLimit(`klip:rl:shorten:ip:${request.ip}`, SHORTEN_RATE_LIMIT, SHORTEN_RATE_WINDOW);
  if (!rl.allowed) {
    reply.header('Retry-After', String(SHORTEN_RATE_WINDOW));
    return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Please slow down.' });
  }

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

  // URL safety: scheme / private-host / DNS-rebinding / self-referential /
  // domain blocklist / Safe Browsing. Runs only on this write path (never on
  // the redirect hot path) and before any ID allocation or DB writes.
  try {
    await validateUrl(body.url, request.log);
  } catch (err) {
    if (err instanceof UrlSafetyError) {
      return sendUrlSafetyError(err, reply);
    }
    // Unexpected error inside the validator → fail closed (do not create a link
    // we could not vet).
    request.log.error({ err }, 'shorten: url safety check errored');
    return reply.code(500).send({ error: 'internal_error', message: 'Could not validate the URL.' });
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

  const pgPool = getPool();
  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');

    // Generate created_at once in the app and write the SAME value to both
    // tables. (Using now() in one and a RETURNING round-trip in the other
    // drifts by sub-millisecond — pg keeps microseconds, JS Date keeps only
    // milliseconds — which breaks the exact `l.created_at = lcl.created_at`
    // join used by the read/stats paths.) It's also the partition key.
    const createdAt = new Date();

    // Insert the global code lookup first: atomically detects alias collisions
    // (ON CONFLICT DO NOTHING) before we touch the partitioned links table.
    const lookupSql = body.customAlias
      ? `INSERT INTO links_code_lookup (short_code, link_id, created_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (short_code) DO NOTHING
         RETURNING short_code`
      : `INSERT INTO links_code_lookup (short_code, link_id, created_at)
         VALUES ($1, $2, $3)
         RETURNING short_code`;
    const lookup = await client.query(lookupSql, [shortCode, id, createdAt]);

    if (lookup.rows.length === 0) {
      // Only reachable on the alias path (a fresh unique code can't conflict).
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'alias_taken', message: 'This alias is already in use.' });
    }

    await client.query(
      `INSERT INTO links
         (id, short_code, long_url, owner_id, is_private, prefer_301, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, shortCode, body.url, ownerId, body.private, !body.analytics, body.expiresAt ?? null, createdAt],
    );

    // Explicit commit — data is durable and visible to other clients now.
    await client.query('COMMIT');

    // 4. Best-effort cache — only for public, analytics-on (302) links, matching
    // the redirect read path. Store {u,id} so cache-hit redirects can still
    // record analytics. A Redis hiccup must not fail link creation.
    if (!body.private && body.analytics) {
      try {
        await setCachedUrl(shortCode, body.url);
      } catch (err) {
        request.log.warn({ err, shortCode }, 'shorten: redis cache write failed (non-fatal)');
      }
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
