import { createPostgresLinkRepository } from './adapters/PostgresLinkRepository';
import { createCounterIdGenerator } from './adapters/CounterIdGenerator';
import { createHashidsShortCodeCodec } from './adapters/HashidsShortCodeCodec';
import { createRedisCache } from './adapters/RedisCache';
import { createUrlSafetyValidator } from './adapters/UrlSafetyValidator';
import { createPostgresAuditLog } from './adapters/PostgresAuditLog';
import { createSystemClock } from './adapters/SystemClock';
import { createShortenLinkUseCase } from './application/shorten/ShortenLinkUseCase';
import { createSmtpEmailSender } from './adapters/SmtpEmailSender';
import { Logger, EmailSender } from './ports';
import { env } from './env';

/**
 * Composition root for the Shorten slice: assembles the use-case from real
 * adapters. The adapters resolve getPool()/getRedis() LAZILY inside their methods,
 * so the db.__setClientsForTest seam still swaps the backing clients — nothing
 * here captures a live client at construction. `log` is the per-request logger
 * (used by the audit + validator fail-open warnings).
 */
export function getShortenLinkUseCase(log: Logger) {
  return createShortenLinkUseCase({
    links: createPostgresLinkRepository(),
    ids: createCounterIdGenerator(),
    codec: createHashidsShortCodeCodec(),
    cache: createRedisCache(),
    validator: createUrlSafetyValidator(),
    audit: createPostgresAuditLog(log),
    clock: createSystemClock(),
  });
}

/**
 * The configured email sender, or `null` when email isn't set up. Returns an SMTP
 * adapter (Mailpit in dev; any relay/provider in prod) only when BOTH SMTP_HOST and
 * EMAIL_FROM are present; otherwise callers degrade gracefully (dev returns the
 * magic link in the response; prod logs a warning). Resolved at call time so a
 * `.env` change takes effect on the next restart without recomposing at load.
 */
export function getEmailSender(): EmailSender | null {
  if (env.SMTP_HOST && env.EMAIL_FROM) {
    return createSmtpEmailSender({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      secure: env.SMTP_SECURE,
      from: env.EMAIL_FROM,
    });
  }
  return null;
}
