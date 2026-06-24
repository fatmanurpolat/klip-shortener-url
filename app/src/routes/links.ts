import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
import { SHORT_BASE_URL } from '../env';
import { setCachedUrl, setTombstone, invalidateCachedUrl } from '../cache';
import { requireAuth } from '../middleware/authenticate';
import { validateUrl, UrlSafetyError, urlSafetyResponse } from '../security/urlSafety';

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
    shortUrl: `${SHORT_BASE_URL}/${r.short_code}`,
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
  is_disabled: boolean;
}

/** Resolve a link (partition-pruned join). Null if it doesn't exist. */
async function resolveLink(code: string): Promise<OwnedLink | null> {
  const res = await getPool().query<OwnedLink>(
    `SELECT l.id, l.created_at, l.owner_id, l.long_url, l.expires_at, l.is_private, l.prefer_301, l.is_disabled
       FROM links_code_lookup lcl
       JOIN links l ON l.id = lcl.link_id AND l.created_at = lcl.created_at
      WHERE lcl.short_code = $1`,
    [code],
  );
  return res.rows[0] ?? null;
}

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
  // An admin-disabled link must NOT be editable by its owner: the PATCH below
  // re-publishes to the redirect cache (setCachedUrl), which would resurrect a
  // disabled link as a live 302 — an abuse-mitigation/authorization bypass.
  // Disabling is terminal for the owner; refuse the edit outright.
  if (link.is_disabled) {
    return reply.code(409).send({ error: 'link_disabled', message: 'This link has been disabled and can no longer be edited.' });
  }

  // Re-run URL safety on any new destination: PATCH is a write path too, and it
  // republishes to the redirect cache below. Without this an owner could create a
  // benign link, then repoint it at an internal/blocked/malicious host — bypassing
  // every check the shorten path enforces.
  if (body.longUrl !== undefined) {
    try {
      await validateUrl(body.longUrl, request.log);
    } catch (err) {
      if (err instanceof UrlSafetyError) {
        const { status, body: errBody } = urlSafetyResponse(err);
        return reply.code(status).send(errBody);
      }
      request.log.error({ err }, 'patch link: url safety check errored');
      return reply.code(500).send({ error: 'internal_error', message: 'Could not validate the URL.' });
    }
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
  // as a servable URL; anything else stops serving the old cached URL now.
  const expired = newExpiresAt !== null && newExpiresAt.getTime() <= Date.now();
  if (!newPrivate && !newPrefer301 && !expired) {
    // Still a public 302 link → cache the (possibly new) URL.
    await setCachedUrl(code, newLongUrl);
  } else if (newPrivate || expired) {
    // Privatized or expired → tombstone so the old URL stops serving immediately.
    await setTombstone(code, expired ? 'EXPIRED' : 'DELETED');
  } else {
    // Now a 301 link (analytics off) but still valid → just drop it from cache;
    // the redirect resolves it from the DB as a 301 (a tombstone would 404 it).
    await invalidateCachedUrl(code);
  }

  return reply.code(200).send({
    code,
    shortUrl: `${SHORT_BASE_URL}/${code}`,
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
  await setTombstone(code, 'DELETED');

  return reply.code(204).send();
}

export async function registerLinksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/links', { preHandler: requireAuth }, handleListLinks);
  app.patch('/api/v1/links/:code', { preHandler: requireAuth }, handlePatchLink);
  app.delete('/api/v1/links/:code', { preHandler: requireAuth }, handleDeleteLink);
}
