import {
  LinkRepository,
  IdGenerator,
  ShortCodeCodec,
  Cache,
  UrlValidator,
  AuditLog,
  Clock,
  Logger,
} from '../../ports';
import { COUNTER_OFFSET } from '../../domain/codes';
import { UrlSafetyError } from '../../security/urlSafety';

// Active-link quotas (not disabled, not expired). Domain policy — lives with the
// use case, not in a SQL string or the HTTP handler. AUTH_QUOTA caps each
// signed-in user at 1,000 active links; ANON_QUOTA caps anonymous shorteners per
// IP prefix. Disabled/expired links don't count, so deleting/expiring frees room.
export const ANON_QUOTA = 100;
export const AUTH_QUOTA = 1_000;

// Path segments that must never be a custom alias (they shadow real routes).
const RESERVED_WORDS = new Set([
  'api', 'v1', 'admin', 'login', 'signup', 'logout', 'dashboard', 'settings',
  'account', 'health', 'healthz', 'assets', 'static', 'favicon.ico', 'robots.txt',
]);

/** Already Zod-validated at the HTTP edge (http/https url, alias regex, etc.). */
export interface ShortenInput {
  url: string;
  customAlias?: string;
  expiresAt: string | null;
  private: boolean;
  analytics: boolean;
  ownerId: string | null;
  /** ipPrefix(getClientIp(req)); '' when unavailable. */
  ipPrefix: string;
  log: Logger;
}

export type ShortenError =
  | { kind: 'auth_required' }
  | { kind: 'reserved_alias' }
  | { kind: 'unsafe_url'; error: UrlSafetyError }
  | { kind: 'quota_exceeded' }
  | { kind: 'quota_unavailable' }
  | { kind: 'counter_unavailable' }
  | { kind: 'alias_taken' }
  | { kind: 'persist_failed' };

export interface ShortenSuccess {
  shortCode: string;
  longUrl: string;
  createdAt: Date;
  expiresAt: string | null;
  private: boolean;
  analytics: boolean;
}

export type ShortenResult =
  | { ok: true; value: ShortenSuccess }
  | { ok: false; error: ShortenError };

export interface ShortenDeps {
  links: LinkRepository;
  ids: IdGenerator;
  codec: ShortCodeCodec;
  cache: Cache;
  validator: UrlValidator;
  audit: AuditLog;
  clock: Clock;
  /**
   * Active-link caps. Injected by the composition root (env-driven) so the limit
   * is tunable without code changes; defaults to ANON_QUOTA/AUTH_QUOTA when omitted
   * (keeps unit tests and any direct caller working).
   */
  quotas?: { anon: number; auth: number };
}

/**
 * The shorten write path, free of HTTP/Fastify. Orchestrates: auth gate →
 * reserved alias → url safety → quota → id+code → persist → audit → cache.
 * Returns a typed ShortenResult; the only THROW it propagates is an unexpected
 * (non-UrlSafetyError) failure from the validator (the HTTP adapter maps that to
 * a 500, exactly as before).
 */
export function createShortenLinkUseCase(deps: ShortenDeps) {
  const { links, ids, codec, cache, validator, audit, clock } = deps;
  const quotas = deps.quotas ?? { anon: ANON_QUOTA, auth: AUTH_QUOTA };

  return async function execute(input: ShortenInput): Promise<ShortenResult> {
    // Auth gate: private links require an authenticated owner.
    if (input.private && !input.ownerId) {
      return { ok: false, error: { kind: 'auth_required' } };
    }

    // Reserved alias.
    if (input.customAlias && RESERVED_WORDS.has(input.customAlias.toLowerCase())) {
      return { ok: false, error: { kind: 'reserved_alias' } };
    }

    // URL safety. A UrlSafetyError is a typed rejection; any other throw
    // propagates so the HTTP adapter fails closed with a 500.
    try {
      await validator.validate(input.url, input.log);
    } catch (err) {
      if (err instanceof UrlSafetyError) {
        return { ok: false, error: { kind: 'unsafe_url', error: err } };
      }
      throw err;
    }

    // Active-link quota. Anonymous with no usable IP prefix is unenforceable →
    // skip (as before). A count failure fails CLOSED (503), never lets an abuser past.
    if (input.ownerId || input.ipPrefix) {
      let count: number;
      try {
        count = await links.countActiveLinks({ ownerId: input.ownerId, ipPrefix: input.ipPrefix });
      } catch (err) {
        input.log.error({ err }, 'shorten: quota check failed');
        return { ok: false, error: { kind: 'quota_unavailable' } };
      }
      const limit = input.ownerId ? quotas.auth : quotas.anon;
      if (count >= limit) {
        return { ok: false, error: { kind: 'quota_exceeded' } };
      }
    }

    // Allocate a unique ID and derive the code. Custom aliases also consume an ID
    // so link_id uniquely identifies one row.
    let seq: bigint;
    try {
      seq = await ids.nextId();
    } catch (err) {
      input.log.error({ err }, 'shorten: ID counter unavailable');
      return { ok: false, error: { kind: 'counter_unavailable' } };
    }
    const id = (seq + COUNTER_OFFSET).toString();
    const shortCode = input.customAlias ?? codec.encode(seq);

    // Persist (one transaction). created_at is generated once and written to both
    // tables (it's the partition key + the read-path join key).
    const createdAt = clock.now();
    let result;
    try {
      result = await links.createLink({
        id,
        shortCode,
        longUrl: input.url,
        ownerId: input.ownerId,
        isPrivate: input.private,
        prefer301: !input.analytics,
        expiresAt: input.expiresAt,
        createdAt,
        ipPrefix: input.ipPrefix || null,
        isCustomAlias: input.customAlias !== undefined,
      });
    } catch (err) {
      input.log.error({ err }, 'shorten: failed to persist link');
      return { ok: false, error: { kind: 'persist_failed' } };
    }
    if (!result.ok) {
      return { ok: false, error: { kind: 'alias_taken' } };
    }

    // Audit (fire-and-forget) + best-effort cache (only public, analytics-on 302
    // links, matching the redirect read path). A cache hiccup must not fail it.
    audit.record({
      shortCode,
      longUrl: input.url,
      ownerId: input.ownerId,
      ipPrefix: input.ipPrefix || null,
      createdAt,
    });
    if (!input.private && input.analytics) {
      try {
        await cache.cacheUrl(shortCode, input.url);
      } catch (err) {
        input.log.warn({ err, shortCode }, 'shorten: redis cache write failed (non-fatal)');
      }
    }

    return {
      ok: true,
      value: {
        shortCode,
        longUrl: input.url,
        createdAt,
        expiresAt: input.expiresAt,
        private: input.private,
        analytics: input.analytics,
      },
    };
  };
}
