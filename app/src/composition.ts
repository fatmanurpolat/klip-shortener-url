import { createPostgresLinkRepository } from './adapters/PostgresLinkRepository';
import { createCounterIdGenerator } from './adapters/CounterIdGenerator';
import { createHashidsShortCodeCodec } from './adapters/HashidsShortCodeCodec';
import { createRedisCache } from './adapters/RedisCache';
import { createUrlSafetyValidator } from './adapters/UrlSafetyValidator';
import { createPostgresAuditLog } from './adapters/PostgresAuditLog';
import { createSystemClock } from './adapters/SystemClock';
import { createShortenLinkUseCase } from './application/shorten/ShortenLinkUseCase';
import { Logger } from './ports';

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
