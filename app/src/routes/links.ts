import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool, getRedis } from '../db';
import { env } from '../env';
import { requireAuth } from '../middleware/authenticate';

/**
 * GET /api/v1/links — the authenticated user's links, newest first, with
 * keyset (cursor) pagination on (created_at DESC, id DESC).
 */

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

interface Cursor {
  id: string; // bigint as string (precision-safe)
  createdAt: string; // ISO
}

function decodeCursor(raw: string): Cursor | null {
  try {
    const json = Buffer.from(raw, 'base64').toString('utf8');
    const obj = JSON.parse(json) as { id?: unknown; createdAt?: unknown };
    if (
      (typeof obj.id === 'string' || typeof obj.id === 'number') &&
      typeof obj.createdAt === 'string' &&
      !Number.isNaN(new Date(obj.createdAt).getTime())
    ) {
      return { id: String(obj.id), createdAt: obj.createdAt };
    }
    return null;
  } catch {
    return null;
  }
}

function encodeCursor(id: string, createdAtIso: string): string {
  return Buffer.from(JSON.stringify({ id, createdAt: createdAtIso }), 'utf8').toString('base64');
}

interface LinkRow {
  id: string;
  short_code: string;
  long_url: string;
  created_at: Date;
  expires_at: Date | null;
  is_private: boolean;
  prefer_301: boolean;
  total_clicks: string;
}

async function handleListLinks(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const user = request.user;
  if (!user) {
    return reply.code(401).send({ error: 'auth_required' });
  }

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'limit must be an integer 1–100.' });
  }
  const { limit } = parsed.data;

  let cursor: Cursor | null = null;
  if (parsed.data.cursor !== undefined) {
    cursor = decodeCursor(parsed.data.cursor);
    if (cursor === null) {
      return reply.code(400).send({ error: 'invalid_cursor', message: 'Invalid pagination cursor.' });
    }
  }

  // Build params: $1 owner; optional cursor tuple; trailing limit.
  const params: unknown[] = [user.userId];
  let cursorClause = '';
  if (cursor) {
    cursorClause = ` AND (l.created_at, l.id) < ($${params.length + 1}::timestamptz, $${params.length + 2}::bigint)`;
    params.push(cursor.createdAt, cursor.id);
  }
  const limitPlaceholder = `$${params.length + 1}`;
  params.push(limit);

  // Aggregate clicks across all (partitioned) link rows for this owner.
  const sql = `
    SELECT l.id, l.short_code, l.long_url, l.created_at, l.expires_at,
           l.is_private, l.prefer_301,
           COALESCE(SUM(cd.clicks), 0)::bigint AS total_clicks
      FROM links l
      LEFT JOIN clicks_daily cd ON cd.link_id = l.id
     WHERE l.owner_id = $1${cursorClause}
     GROUP BY l.id, l.short_code, l.long_url, l.created_at, l.expires_at, l.is_private, l.prefer_301
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${limitPlaceholder}`;

  const res = await getPool().query<LinkRow>(sql, params);

  const links = res.rows.map((r) => ({
    code: r.short_code,
    shortUrl: `https://${env.SHORT_DOMAIN}/${r.short_code}`,
    longUrl: r.long_url,
    createdAt: r.created_at.toISOString(),
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    private: r.is_private,
    analytics: !r.prefer_301,
    clicks: Number(r.total_clicks),
  }));

  let nextCursor: string | null = null;
  if (res.rows.length === limit) {
    const last = res.rows[res.rows.length - 1];
    nextCursor = encodeCursor(last.id, last.created_at.toISOString());
  }

  return reply.code(200).send({ links, nextCursor });
}

// -----------------------------------------------------------------------------
// Edit / delete
// -----------------------------------------------------------------------------

const patchSchema = z.object({
  longUrl: z.string().url().max(2048).optional(),
  expiresAt: z.string().datetime().nullable().optional(), // null = remove expiry
  private: z.boolean().optional(),
  analytics: z.boolean().optional(), // maps to prefer_301 = !analytics
});

interface OwnedLink {
  id: string;
  created_at: Date;
  owner_id: string | null;
  long_url: string;
  expires_at: Date | null;
  is_private: boolean;
  prefer_301: boolean;
}

/** Resolve a link (partition-pruned join). Null if it doesn't exist. */
async function resolveLink(code: string): Promise<OwnedLink | null> {
  const res = await getPool().query<OwnedLink>(
    `SELECT l.id, l.created_at, l.owner_id, l.long_url, l.expires_at, l.is_private, l.prefer_301
       FROM links_code_lookup lcl
       JOIN links l ON l.id = lcl.link_id AND l.created_at = lcl.created_at
      WHERE lcl.short_code = $1`,
    [code],
  );
  return res.rows[0] ?? null;
}

const cacheKey = (code: string): string => `klip:url:${code}`;

async function handlePatchLink(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const user = request.user;
  if (!user) return reply.code(401).send({ error: 'auth_required' });

  const { code } = request.params as { code: string };
  const parsed = patchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: parsed.error.issues[0]?.message ?? 'Invalid body.' });
  }
  const body = parsed.data;

  const link = await resolveLink(code);
  if (!link) return reply.code(404).send({ error: 'not_found', message: 'Link not found.' });
  if (link.owner_id !== user.userId) {
    return reply.code(403).send({ error: 'forbidden', message: 'You do not own this link.' });
  }

  // Partial update: only the provided fields.
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.longUrl !== undefined) {
    params.push(body.longUrl);
    sets.push(`long_url = $${params.length}`);
  }
  if (body.expiresAt !== undefined) {
    params.push(body.expiresAt); // string or null
    sets.push(`expires_at = $${params.length}`);
  }
  if (body.private !== undefined) {
    params.push(body.private);
    sets.push(`is_private = $${params.length}`);
  }
  if (body.analytics !== undefined) {
    params.push(!body.analytics);
    sets.push(`prefer_301 = $${params.length}`);
  }
  if (sets.length === 0) {
    return reply.code(400).send({ error: 'validation_error', message: 'No updatable fields provided.' });
  }

  params.push(link.id);
  const idP = params.length;
  params.push(link.created_at);
  const createdP = params.length;
  await getPool().query(
    `UPDATE links SET ${sets.join(', ')} WHERE id = $${idP} AND created_at = $${createdP}`,
    params,
  );

  // New state after the update.
  const newLongUrl = body.longUrl ?? link.long_url;
  const newExpiresAt =
    body.expiresAt !== undefined
      ? body.expiresAt === null
        ? null
        : new Date(body.expiresAt)
      : link.expires_at;
  const newPrivate = body.private ?? link.is_private;
  const newPrefer301 = body.analytics !== undefined ? !body.analytics : link.prefer_301;

  // Cache invalidation. Only public, non-301, non-expired links may be cached
  // as a servable URL; anything else gets a short DELETED tombstone so the old
  // cached URL stops being served immediately.
  const key = cacheKey(code);
  const redis = getRedis();
  const expired = newExpiresAt !== null && newExpiresAt.getTime() <= Date.now();
  if (!newPrivate && !newPrefer301 && !expired) {
    // Still a public 302 link → cache the (possibly new) URL.
    await redis.set(key, JSON.stringify({ u: newLongUrl, id: link.id }), 'EX', env.REDIS_URL_TTL);
  } else if (newPrivate || expired) {
    // Privatized or expired → hard tombstone so the old URL stops serving now.
    await redis.del(key);
    await redis.set(key, 'DELETED', 'EX', 60);
  } else {
    // Now a 301 link (analytics off) but still valid → just drop it from cache;
    // the redirect resolves it from the DB as a 301 (a tombstone would 404 it).
    await redis.del(key);
  }

  return reply.code(200).send({
    code,
    shortUrl: `https://${env.SHORT_DOMAIN}/${code}`,
    longUrl: newLongUrl,
    createdAt: link.created_at.toISOString(),
    expiresAt: newExpiresAt ? newExpiresAt.toISOString() : null,
    private: newPrivate,
    analytics: !newPrefer301,
  });
}

async function handleDeleteLink(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const user = request.user;
  if (!user) return reply.code(401).send({ error: 'auth_required' });

  const { code } = request.params as { code: string };

  const link = await resolveLink(code);
  if (!link) return reply.code(404).send({ error: 'not_found', message: 'Link not found.' });
  if (link.owner_id !== user.userId) {
    return reply.code(403).send({ error: 'forbidden', message: 'You do not own this link.' });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM links_code_lookup WHERE short_code = $1', [code]);
    await client.query('DELETE FROM links WHERE id = $1 AND created_at = $2', [link.id, link.created_at]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // Tombstone so GET /:code 404s immediately (not after the URL TTL expires).
  const key = cacheKey(code);
  const redis = getRedis();
  await redis.del(key);
  await redis.set(key, 'DELETED', 'EX', 60);

  return reply.code(204).send();
}

export async function registerLinksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/links', { preHandler: requireAuth }, handleListLinks);
  app.patch('/api/v1/links/:code', { preHandler: requireAuth }, handlePatchLink);
  app.delete('/api/v1/links/:code', { preHandler: requireAuth }, handleDeleteLink);
}
