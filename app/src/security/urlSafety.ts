import { promises as dns } from 'node:dns';
import { createHash } from 'node:crypto';
import * as ipaddr from 'ipaddr.js';
import { getPool, getRedis } from '../db';
import { env } from '../env';

/**
 * URL safety validation for the WRITE path (POST /api/v1/shorten).
 *
 * Every check here runs ONCE, at shorten time, BEFORE a link row is created. It
 * is deliberately kept OFF the redirect hot path (which must stay a single
 * cached lookup). The goal is SSRF / DNS-rebinding prevention and basic abuse
 * blocking: a short link must never become a proxy to an internal service, nor
 * a vector for a known-malicious destination.
 *
 * {@link validateUrl} throws {@link UrlSafetyError} (carrying a stable `code`)
 * on the first failed check; the shorten handler maps each code to an HTTP
 * status. A passing call returns void.
 */

export type UrlSafetyCode =
  | 'INVALID_SCHEME'
  | 'PRIVATE_HOST'
  | 'UNRESOLVABLE_HOST'
  | 'SELF_REFERENTIAL'
  | 'BLOCKED_DOMAIN'
  | 'MALICIOUS_URL';

/** Thrown when a URL fails a safety check. `code` is stable for HTTP mapping. */
export class UrlSafetyError extends Error {
  readonly code: UrlSafetyCode;
  constructor(code: UrlSafetyCode, message: string) {
    super(message);
    this.name = 'UrlSafetyError';
    this.code = code;
  }
}

/** Minimal logger shape — satisfied by Fastify's `request.log` and `console`. */
type Logger = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const SAFE_BROWSING_TTL = 12 * 60 * 60; // 12 hours, in seconds
const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';

/**
 * True if `ip` (a literal IPv4/IPv6 string) is anything other than a normal,
 * publicly-routable unicast address. Default-deny: loopback, private,
 * link-local, unique-local, unspecified, multicast, reserved, broadcast and
 * CGNAT all return true. IPv4-mapped IPv6 (e.g. `::ffff:127.0.0.1`) is unwrapped
 * first so a private IPv4 cannot be smuggled past the check inside an IPv6
 * literal. An unparseable value is treated as blocked (fail closed).
 */
function isBlockedIp(ip: string): boolean {
  if (!ipaddr.isValid(ip)) return true;
  const addr = ipaddr.parse(ip);
  if (addr instanceof ipaddr.IPv6 && addr.isIPv4MappedAddress()) {
    return isBlockedIp(addr.toIPv4Address().toString());
  }
  return addr.range() !== 'unicast';
}

/** Step 5 — reject if the hostname is on the DB domain blocklist. */
async function checkDomainBlocklist(host: string): Promise<void> {
  // Matches an exact entry ("evil.com") or a leading-dot entry (".evil.com").
  const result = await getPool().query(
    'SELECT 1 FROM blocked_domains WHERE domain = $1 OR domain = $2 LIMIT 1',
    [host, `.${host}`],
  );
  if ((result.rowCount ?? 0) > 0) {
    throw new UrlSafetyError('BLOCKED_DOMAIN', 'This domain has been blocked.');
  }
}

/**
 * Step 6 — Google Safe Browsing lookup, cached in Redis for 12h and FAIL-OPEN:
 * any API/transport error logs and allows the URL (availability over strict
 * blocking). Only a positive match — fresh or cached — rejects.
 */
async function checkSafeBrowsing(url: string, apiKey: string, log: Logger): Promise<void> {
  const redis = getRedis();
  const cacheKey = `klip:safebrowsing:${createHash('sha256').update(url).digest('hex')}`;

  // Cache first. A Redis read failure is non-fatal — fall through to the API.
  let cached: string | null = null;
  try {
    cached = await redis.get(cacheKey);
  } catch (err) {
    log.warn({ err }, 'safe browsing: redis read failed; querying API');
  }
  if (cached === 'SAFE') return;
  if (cached === 'MALICIOUS') {
    throw new UrlSafetyError('MALICIOUS_URL', 'This URL was flagged as malicious.');
  }

  try {
    const res = await fetch(`${SAFE_BROWSING_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client: { clientId: 'klip', clientVersion: '1.0' },
        threatInfo: {
          threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE'],
          platformTypes: ['ANY_PLATFORM'],
          threatEntryTypes: ['URL'],
          threatEntries: [{ url }],
        },
      }),
    });

    if (!res.ok) {
      log.warn({ status: res.status }, 'safe browsing: non-OK response; allowing (fail open)');
      return;
    }

    const data = (await res.json()) as { matches?: unknown[] };
    const flagged = Array.isArray(data.matches) && data.matches.length > 0;

    // Cache the verdict (best-effort) so repeat shortens skip the API call.
    try {
      await redis.set(cacheKey, flagged ? 'MALICIOUS' : 'SAFE', 'EX', SAFE_BROWSING_TTL);
    } catch (err) {
      log.warn({ err }, 'safe browsing: redis write failed (non-fatal)');
    }

    if (flagged) {
      throw new UrlSafetyError('MALICIOUS_URL', 'This URL was flagged as malicious.');
    }
  } catch (err) {
    if (err instanceof UrlSafetyError) throw err; // deliberate rejection — propagate
    log.warn({ err }, 'safe browsing: check failed; allowing (fail open)');
  }
}

/**
 * Validate a destination URL before it is shortened. Throws {@link UrlSafetyError}
 * on the first failed check; returns void if every check passes.
 *
 * The optional `log` is used only for the fail-open Safe Browsing path; callers
 * may invoke `validateUrl(url)` exactly as specified and logging falls back to
 * `console`. The shorten handler passes `request.log` for structured output.
 */
export async function validateUrl(url: string, log: Logger = console): Promise<void> {
  // 1. SCHEME CHECK -----------------------------------------------------------
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlSafetyError('INVALID_SCHEME', 'URL is malformed.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlSafetyError(
      'INVALID_SCHEME',
      `Unsupported URL scheme "${parsed.protocol}". Only http and https are allowed.`,
    );
  }

  // WHATWG `hostname` keeps IPv6 literals in brackets — strip them so the value
  // parses as an IP. Lower-cased for hostname comparisons (host is ASCII here:
  // URL has already punycoded any IDN).
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();

  // 2. PRIVATE IP / LOCALHOST BLOCKLIST (literal host) ------------------------
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UrlSafetyError('PRIVATE_HOST', 'URL points to localhost, which is not allowed.');
  }
  const hostIsIpLiteral = ipaddr.isValid(host);
  if (hostIsIpLiteral && isBlockedIp(host)) {
    throw new UrlSafetyError('PRIVATE_HOST', 'URL points to a private, loopback, or reserved IP address.');
  }

  // 3. DNS RESOLUTION + REBINDING PROTECTION ----------------------------------
  // Only for DNS names — an IP literal has nothing to resolve and was fully
  // vetted in step 2. Resolving both families and checking EVERY answer is what
  // defends against DNS rebinding (a public name that maps to an internal IP).
  if (!hostIsIpLiteral) {
    let v4: string[] = [];
    let v6: string[] = [];
    try {
      v4 = await dns.resolve4(host);
    } catch {
      /* no A records (or NXDOMAIN) — handled by the combined emptiness check */
    }
    try {
      v6 = await dns.resolve6(host);
    } catch {
      /* no AAAA records */
    }
    const resolved = [...v4, ...v6];
    if (resolved.length === 0) {
      throw new UrlSafetyError('UNRESOLVABLE_HOST', 'The URL hostname could not be resolved.');
    }
    for (const ip of resolved) {
      if (isBlockedIp(ip)) {
        throw new UrlSafetyError(
          'PRIVATE_HOST',
          'The URL hostname resolves to a private or reserved IP address.',
        );
      }
    }
  }

  // 4. SELF-REFERENTIAL LOOP --------------------------------------------------
  const shortDomain = env.SHORT_DOMAIN.toLowerCase();
  if (host === shortDomain || host.endsWith(`.${shortDomain}`)) {
    throw new UrlSafetyError('SELF_REFERENTIAL', 'Cannot shorten a link that points back at this shortener.');
  }

  // 5. DOMAIN BLOCKLIST (DB) --------------------------------------------------
  await checkDomainBlocklist(host);

  // 6. GOOGLE SAFE BROWSING (optional, cached, fail-open) ---------------------
  if (env.SAFE_BROWSING_API_KEY) {
    await checkSafeBrowsing(url, env.SAFE_BROWSING_API_KEY, log);
  }
}
