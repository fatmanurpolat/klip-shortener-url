import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
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

export async function registerLinksRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/links', { preHandler: requireAuth }, handleListLinks);
}
