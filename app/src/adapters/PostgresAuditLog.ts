import { getPool } from '../db';
import { AuditLog, AuditEntry, Logger } from '../ports';

/**
 * Postgres adapter for AuditLog. Fire-and-forget via setImmediate (exactly as the
 * route did): never awaited, never blocks/fails the response. `log` is the
 * request logger for the non-fatal warning.
 */
export function createPostgresAuditLog(log: Logger): AuditLog {
  return {
    record(entry: AuditEntry): void {
      setImmediate(() => {
        getPool()
          .query(
            `INSERT INTO shorten_audit (short_code, long_url, owner_id, ip_prefix, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [entry.shortCode, entry.longUrl, entry.ownerId, entry.ipPrefix, entry.createdAt],
          )
          .catch((err) => log.warn({ err, shortCode: entry.shortCode }, 'shorten: audit write failed (non-fatal)'));
      });
    },
  };
}
