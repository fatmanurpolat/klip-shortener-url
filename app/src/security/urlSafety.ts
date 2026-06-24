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

// HTTP status per failure code: 400 = bad client input; 422 = a well-formed but
// disallowed destination (blocked domain / known-malicious).
const URL_SAFETY_STATUS: Record<UrlSafetyCode, number> = {
  INVALID_SCHEME: 400,
  PRIVATE_HOST: 400,
  UNRESOLVABLE_HOST: 400,
  SELF_REFERENTIAL: 400,
  BLOCKED_DOMAIN: 422,
  MALICIOUS_URL: 422,
};

// `error` field per code; the two 422s share "unsafe_url" per the API contract.
const URL_SAFETY_ERROR_FIELD: Record<UrlSafetyCode, string> = {
  INVALID_SCHEME: 'invalid_url',
  PRIVATE_HOST: 'blocked_host',
  UNRESOLVABLE_HOST: 'unresolvable_host',
  SELF_REFERENTIAL: 'self_referential',
  BLOCKED_DOMAIN: 'unsafe_url',
  MALICIOUS_URL: 'unsafe_url',
};

/**
 * Framework-agnostic HTTP mapping for a {@link UrlSafetyError}, shared by every
 * write path (POST /shorten and PATCH /links/:code) so they stay in lockstep.
 */
export function urlSafetyResponse(err: UrlSafetyError): {
  status: number;
  body: { error: string; message: string };
} {
  return {
    status: URL_SAFETY_STATUS[err.code],
    body: { error: URL_SAFETY_ERROR_FIELD[err.code], message: err.message },
  };
}

/** Minimal logger shape — satisfied by Fastify's `request.log` and `console`. */
type Logger = { warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const SAFE_BROWSING_TTL = 12 * 60 * 60; // 12 hours, in seconds
const SAFE_BROWSING_ENDPOINT = 'https://safebrowsing.googleapis.com/v4/threatMatches:find';
const SAFE_BROWSING_TIMEOUT_MS = 3000; // upstream-hang guard; a timeout fails open
const DNS_TIMEOUT_MS = 3000; // bound each DNS lookup so a slow resolver can't stall a shorten

/** Reject `p` if it hasn't settled within `ms`. Clears its timer either way. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

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
  if (addr instanceof ipaddr.IPv6) {
    // Unwrap IPv6 forms that embed an IPv4 in their low 32 bits and recurse, so a
    // private IPv4 cannot be smuggled past the default-deny below:
    //   ::ffff:a.b.c.d  — IPv4-mapped (::ffff:0:0/96)
    //   ::a.b.c.d       — deprecated IPv4-compatible (::/96). ipaddr.js reports
    //                     the compressed hex form (e.g. ::a9fe:a9fe) as plain
    //                     'unicast', so it MUST be unwrapped explicitly or a
    //                     loopback/RFC1918/metadata target slips through.
    if (addr.isIPv4MappedAddress()) {
      return isBlockedIp(addr.toIPv4Address().toString());
    }
    const bytes = addr.toByteArray(); // 16 bytes, network order
    if (bytes.slice(0, 12).every((b) => b === 0)) {
      // ::/96 — also covers :: and ::1, whose embedded IPv4 is in 0.0.0.0/8.
      return isBlockedIp(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
    }
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
  const cacheKey = `klipo:safebrowsing:${createHash('sha256').update(url).digest('hex')}`;

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
      // Bound the call: a hung upstream would otherwise stall the shorten request
      // (fail-open only covers errors). The AbortError lands in the catch below.
      signal: AbortSignal.timeout(SAFE_BROWSING_TIMEOUT_MS),
      body: JSON.stringify({
        client: { clientId: 'klipo', clientVersion: '1.0' },
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
  // parses as an IP. Also strip a single trailing FQDN dot, else "klipo.to." and
  // "evil.com." would dodge the self-referential and exact-match blocklist
  // comparisons below. Lower-cased for hostname comparisons (host is ASCII here:
  // URL has already punycoded any IDN).
  const host = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();

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
    // Resolve both families CONCURRENTLY, each bounded by a timeout, so a slow or
    // black-holed authoritative server can't stall the shorten request. A lookup
    // that errors, has no records, or times out contributes nothing; if NOTHING
    // resolves we fail closed with UNRESOLVABLE_HOST.
    const [r4, r6] = await Promise.allSettled([
      withTimeout(dns.resolve4(host), DNS_TIMEOUT_MS, 'resolve4'),
      withTimeout(dns.resolve6(host), DNS_TIMEOUT_MS, 'resolve6'),
    ]);
    const resolved = [
      ...(r4.status === 'fulfilled' ? r4.value : []),
      ...(r6.status === 'fulfilled' ? r6.value : []),
    ];
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
  // Strip any :port (dev uses SHORT_DOMAIN=localhost:3000) so the comparison
  // matches the parsed URL's host (which carries no port for the default scheme).
  const shortDomain = env.SHORT_DOMAIN.toLowerCase().replace(/:\d+$/, '');
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
