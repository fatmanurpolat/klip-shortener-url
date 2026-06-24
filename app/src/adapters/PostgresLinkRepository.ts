import { getPool } from '../db';
import { LinkRepository, QuotaQuery, NewLink, CreateLinkResult } from '../ports';

// Active-link clause: not disabled, not expired. Same predicate the quota used
// inline before the refactor.
const ACTIVE_CLAUSE = 'NOT is_disabled AND (expires_at IS NULL OR expires_at > now())';

/**
 * Postgres adapter for LinkRepository. Holds the link-table SQL (quota count +
 * the transactional insert) that used to live in routes/shorten.ts, verbatim.
 * Resolves getPool() INSIDE each method so db.__setClientsForTest still swaps it.
 */
export function createPostgresLinkRepository(): LinkRepository {
  return {
    async countActiveLinks(q: QuotaQuery): Promise<number> {
      const pool = getPool();
      if (q.ownerId) {
        const r = await pool.query<{ n: string }>(
          `SELECT count(*)::bigint AS n FROM links WHERE owner_id = $1 AND ${ACTIVE_CLAUSE}`,
          [q.ownerId],
        );
        return Number(r.rows[0].n);
      }
      const r = await pool.query<{ n: string }>(
        `SELECT count(*)::bigint AS n FROM links WHERE owner_id IS NULL AND ip_prefix = $1 AND ${ACTIVE_CLAUSE}`,
        [q.ipPrefix],
      );
      return Number(r.rows[0].n);
    },

    async createLink(link: NewLink): Promise<CreateLinkResult> {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');

        // Insert the global code lookup first: ON CONFLICT atomically detects an
        // alias collision before we touch the partitioned links table.
        const lookupSql = link.isCustomAlias
          ? `INSERT INTO links_code_lookup (short_code, link_id, created_at)
             VALUES ($1, $2, $3)
             ON CONFLICT (short_code) DO NOTHING
             RETURNING short_code`
          : `INSERT INTO links_code_lookup (short_code, link_id, created_at)
             VALUES ($1, $2, $3)
             RETURNING short_code`;
        const lookup = await client.query(lookupSql, [link.shortCode, link.id, link.createdAt]);

        if (lookup.rows.length === 0) {
          // Only reachable on the alias path (a fresh unique code can't conflict).
          await client.query('ROLLBACK');
          return { ok: false, reason: 'alias_taken' };
        }

        await client.query(
          `INSERT INTO links
             (id, short_code, long_url, owner_id, is_private, prefer_301, expires_at, created_at, ip_prefix)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            link.id,
            link.shortCode,
            link.longUrl,
            link.ownerId,
            link.isPrivate,
            link.prefer301,
            link.expiresAt,
            link.createdAt,
            link.ipPrefix,
          ],
        );

        await client.query('COMMIT');
        return { ok: true };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
