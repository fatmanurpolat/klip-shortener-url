import type { FastifyReply, FastifyRequest } from 'fastify';
import * as ipaddr from 'ipaddr.js';
import { getRedis } from '../db';
import { env } from '../env';

/**
 * Production rate limiting for Klipo's key API surfaces.
 *
 * Each surface is a fixed-window counter in Redis (INCR + EXPIRE), evaluated
 * ATOMICALLY in a single Lua script so concurrent requests can't race past the
 * limit. The window is 60s for every surface; per-surface limits and keys are
 * supplied by {@link rateLimit} / {@link getLimitKey}.
 *
 * Fail strategy when Redis is unreachable is per-surface: the redirect hot path
 * FAILS OPEN (availability first), every state-changing/auth path FAILS CLOSED
 * (503) so a Redis outage can't disable abuse protection on the write paths.
 *
 * NOTE: this is a fixed-window counter (the spec's "INCR + EXPIRE" mechanism),
 * not a rolling log; bursts that straddle a window boundary can briefly reach 2x
 * the limit. That trade-off (O(1) memory, one round-trip) is the right one for
 * these surfaces.
 */

/** A Fastify preHandler: short-circuits the route when it sends a response. */
export type FastifyPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

const WINDOW_SECONDS = 60;

interface SurfaceConfig {
  window: number;
  /** true → allow the request through if Redis is down (log a warning). */
  failOpen: boolean;
}

// Per-surface behavior. Limits are passed to rateLimit() (they vary by auth
// state for `shorten`); only window + fail strategy live here.
const SURFACES: Record<string, SurfaceConfig> = {
  shorten: { window: WINDOW_SECONDS, failOpen: false },
  auth: { window: WINDOW_SECONDS, failOpen: false },
  'auth-verify': { window: WINDOW_SECONDS, failOpen: false },
  redirect: { window: WINDOW_SECONDS, failOpen: true },
};

const DEFAULT_SURFACE: SurfaceConfig = { window: WINDOW_SECONDS, failOpen: false };

/**
 * The client IP for rate-limiting purposes. Proxy headers are honored ONLY when
 * TRUST_PROXY=true, and we use the PROXY-ATTESTED client, never a client-supplied
 * value:
 *   1. X-Real-IP — the bundled nginx sets this to the real $remote_addr.
 *   2. else the RIGHT-MOST X-Forwarded-For entry — the one the trusted proxy
 *      appended ($proxy_add_x_forwarded_for appends to any client-sent XFF).
 *
 * We deliberately do NOT take the LEFT-most XFF entry: because nginx appends, the
 * left-most value is attacker-controlled, so a client could rotate it to mint
 * unlimited rate-limit keys and bypass the limit entirely. This assumes a single
 * trusted proxy hop (true for the bundled nginx). When TRUST_PROXY is false the
 * proxy headers are ignored and the direct socket peer (`req.ip`) is used.
 */
export function getClientIp(req: FastifyRequest): string {
  if (env.TRUST_PROXY) {
    // Only accept a syntactically valid IP from the proxy headers; otherwise a
    // garbage/over-long value would become a Redis key (cardinality abuse) — fall
    // back to the socket peer instead.
    const realIp = headerValue(req.headers['x-real-ip']);
    if (realIp && ipaddr.isValid(realIp)) return realIp;

    const xff = headerValue(req.headers['x-forwarded-for']);
    if (xff) {
      const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
      const rightmost = parts[parts.length - 1];
      if (rightmost && ipaddr.isValid(rightmost)) return rightmost;
    }
  }
  return req.ip;
}

/** First non-empty value of a header that may arrive as string | string[]. */
function headerValue(v: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(v) ? v[0] : v;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

const IPV6_BUCKET_PREFIX = 64; // a single client is handed at least a /64

/**
 * Collapse an IP to its rate-limit bucket. IPv6 is masked to a /64 network: a
 * single client controls an entire prefix (residential /64–/56, cloud VMs /64+),
 * so keying on the full /128 would let them rotate addresses within their own
 * allocation to mint unlimited buckets and defeat every per-IP limit. IPv4 (one
 * address per client behind NAT) is keyed as-is. Unparseable input is returned
 * verbatim (req.ip is always valid; this is defensive).
 */
function ipBucket(ip: string): string {
  try {
    if (!ipaddr.isValid(ip)) return ip;
    const addr = ipaddr.parse(ip);
    if (addr instanceof ipaddr.IPv6) {
      if (addr.isIPv4MappedAddress()) return addr.toIPv4Address().toString();
      const net = ipaddr.IPv6.networkAddressFromCIDR(`${ip}/${IPV6_BUCKET_PREFIX}`);
      return `${net.toNormalizedString()}/${IPV6_BUCKET_PREFIX}`;
    }
    return ip; // IPv4
  } catch {
    return ip;
  }
}

/**
 * The Redis key for a (request, surface) pair. `shorten` is keyed by user when
 * authenticated (generous limit) and by IP when anonymous; the two auth surfaces
 * deliberately share one per-IP key (a combined auth budget); the rest are
 * per-IP.
 */
export function getLimitKey(req: FastifyRequest, surface: string): string {
  if (surface === 'shorten') {
    const userId = req.user?.userId;
    if (userId) return `klipo:rl:shorten:user:${userId}`;
  }
  const ip = ipBucket(getClientIp(req));
  switch (surface) {
    case 'shorten':
      return `klipo:rl:shorten:anon:${ip}`;
    case 'auth':
    case 'auth-verify':
      return `klipo:rl:auth:${ip}`;
    case 'redirect':
      return `klipo:rl:redirect:${ip}`;
    default:
      return `klipo:rl:${surface}:${ip}`;
  }
}

// Atomic fixed-window counter. Returns {allowed, remaining, ttl}. The first hit
// in a window sets the TTL; the defensive re-EXPIRE covers a key that somehow
// lost its expiry (TTL == -1) so a counter can never get stuck forever.
const RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
  ttl = tonumber(ARGV[1])
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local limit = tonumber(ARGV[2])
if current > limit then
  return {0, 0, ttl}
end
return {1, limit - current, ttl}
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the current window resets. */
  reset: number;
}

/**
 * Count one hit against `key` within `windowSecs`. Atomic. Throws if Redis is
 * unavailable — callers decide fail-open vs fail-closed.
 */
export async function consumeRateLimit(
  key: string,
  limit: number,
  windowSecs: number,
): Promise<RateLimitResult> {
  const res = (await getRedis().eval(
    RATE_LIMIT_LUA,
    1,
    key,
    String(windowSecs),
    String(limit),
  )) as [number, number, number];
  return { allowed: res[0] === 1, remaining: res[1], reset: res[2] };
}

/**
 * Build a Fastify preHandler enforcing `surface`'s limit. For `shorten`, pass
 * both limits: `anonLimit` applies to anonymous requests, `authLimit` to
 * authenticated ones (selected via request.user). Other surfaces use `anonLimit`.
 */
export function rateLimit(surface: string, anonLimit: number, authLimit?: number): FastifyPreHandler {
  const cfg = SURFACES[surface] ?? DEFAULT_SURFACE;

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const authed = Boolean(request.user?.userId);
    const limit = authed && authLimit !== undefined ? authLimit : anonLimit;
    const key = getLimitKey(request, surface);

    let result: RateLimitResult;
    try {
      result = await consumeRateLimit(key, limit, cfg.window);
    } catch (err) {
      if (cfg.failOpen) {
        request.log.warn({ err, surface }, 'rate limit: Redis unavailable — failing open');
        return; // let the request through
      }
      request.log.error({ err, surface }, 'rate limit: Redis unavailable — failing closed');
      reply.code(503).send({ error: 'service_unavailable', message: 'Service temporarily unavailable.' });
      return;
    }

    // Clamp to >= 1s: Redis TTL has whole-second granularity and can read 0 in the
    // last fraction of a window, which would make Reset say "now" and disagree
    // with Retry-After. Derive BOTH headers from the same value so they agree.
    const reset = Math.max(1, result.reset);
    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, result.remaining)));
    reply.header('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + reset));

    if (!result.allowed) {
      reply
        .code(429)
        .header('Retry-After', String(reset))
        .send({ error: 'rate_limited', message: 'Too many requests. Try again later.' });
      return;
    }
    // allowed → return undefined so the route handler runs.
  };
}
