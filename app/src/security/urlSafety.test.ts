import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as dnsPromises } from 'node:dns';
import { createHash } from 'node:crypto';

// Env must be in place before env.ts (imported transitively by urlSafety.ts)
// loads. SAFE_BROWSING_API_KEY is forced ON so the Safe Browsing path runs and
// can be exercised; SHORT_DOMAIN is pinned for the self-referential test.
process.env.NODE_ENV = 'test';
process.env.SHORT_DOMAIN = 'klipo.to';
process.env.SAFE_BROWSING_API_KEY = 'test-key';
process.env.DATABASE_URL ??= 'postgres://klip:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';

process.env.HASHIDS_SALT ??= 'test-salt-0123456789-abcdef';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';

// -----------------------------------------------------------------------------
// Test doubles. DNS and fetch are swapped for controllable stand-ins; the pg
// pool and redis client are injected through the db test seam.
// -----------------------------------------------------------------------------
type Resolver = (host: string) => Promise<string[]>;
let resolve4Impl: Resolver;
let resolve6Impl: Resolver;

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };
let fetchImpl: () => Promise<FetchResult>;

const notFound = (): never => {
  const err = new Error('ENOTFOUND') as Error & { code: string };
  err.code = 'ENOTFOUND';
  throw err;
};

const okMatches = (matches: unknown[]): FetchResult => ({
  ok: true,
  status: 200,
  json: async () => ({ matches }),
});

/** Quiet logger so fail-open paths don't spam test output. */
const quiet = { warn: () => undefined, error: () => undefined };

function makeFakeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const setCalls: unknown[][] = [];
  return {
    store,
    setCalls,
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async set(key: string, value: string | number, ...rest: unknown[]) {
      setCalls.push([key, value, ...rest]);
      store.set(key, String(value));
      return 'OK';
    },
  };
}

function makeFakePool(opts: { blocked?: boolean } = {}) {
  return {
    async query(sql: string) {
      if (/blocked_domains/i.test(sql)) {
        return opts.blocked
          ? { rows: [{ '?column?': 1 }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

/** Return the thrown UrlSafetyError code, or undefined if the call resolved. */
async function codeOf(p: Promise<void>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

const sbKey = (url: string): string =>
  `klip:safebrowsing:${createHash('sha256').update(url).digest('hex')}`;

let db: typeof import('../db.js');
let urlSafety: typeof import('./urlSafety.js');

before(async () => {
  // Route the (singleton) dns.promises + global fetch through our impls.
  const dnsMut = dnsPromises as unknown as { resolve4: Resolver; resolve6: Resolver };
  dnsMut.resolve4 = (h) => resolve4Impl(h);
  dnsMut.resolve6 = (h) => resolve6Impl(h);
  globalThis.fetch = (() => fetchImpl()) as unknown as typeof fetch;

  db = await import('../db.js');
  urlSafety = await import('./urlSafety.js');
});

beforeEach(() => {
  // Defaults: nothing resolves, fetch returns clean, no blocked domains.
  resolve4Impl = async () => notFound();
  resolve6Impl = async () => notFound();
  fetchImpl = async () => okMatches([]);
  db.__setClientsForTest({
    redis: makeFakeRedis() as unknown as import('ioredis').default,
    pool: makeFakePool() as unknown as import('pg').Pool,
  });
});

// --- 1. Scheme ---------------------------------------------------------------
test('non-http(s) schemes are rejected as INVALID_SCHEME', async () => {
  for (const u of ['ftp://example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
    assert.equal(await codeOf(urlSafety.validateUrl(u, quiet)), 'INVALID_SCHEME', u);
  }
});

test('a malformed URL is rejected as INVALID_SCHEME', async () => {
  assert.equal(await codeOf(urlSafety.validateUrl('not a url', quiet)), 'INVALID_SCHEME');
});

// --- 2. Literal private / reserved hosts -------------------------------------
test('literal private, loopback, link-local and unspecified IPs are PRIVATE_HOST', async () => {
  const hosts = [
    'http://10.0.0.1',
    'http://172.16.5.5',
    'http://172.31.255.254',
    'http://192.168.1.1',
    'http://127.0.0.1',
    'http://169.254.169.254', // cloud metadata endpoint
    'http://0.0.0.0',
    'http://[::1]',
    'http://[fe80::1]',
    'http://[fc00::1]',
    'http://[::]',
    'http://[::ffff:127.0.0.1]', // IPv4-mapped loopback must be unwrapped
    // IPv4-COMPATIBLE IPv6 (::/96): URL normalizes to compressed hex which
    // ipaddr.js reports as 'unicast'; must be unwrapped or it bypasses the block.
    'http://[::127.0.0.1]', // -> ::7f00:1
    'http://[::169.254.169.254]', // -> ::a9fe:a9fe (cloud metadata)
    'http://[::10.0.0.1]', // -> ::a00:1
    'http://[::192.168.1.1]', // -> ::c0a8:101
    'http://[::172.16.0.1]', // -> ::ac10:1
  ];
  for (const u of hosts) {
    assert.equal(await codeOf(urlSafety.validateUrl(u, quiet)), 'PRIVATE_HOST', u);
  }
});

test('localhost and *.localhost are PRIVATE_HOST', async () => {
  assert.equal(await codeOf(urlSafety.validateUrl('http://localhost', quiet)), 'PRIVATE_HOST');
  assert.equal(await codeOf(urlSafety.validateUrl('http://app.localhost', quiet)), 'PRIVATE_HOST');
});

test('a public IP literal passes (skips DNS)', async () => {
  // 8.8.8.8 is unicast; DNS impls would throw if (wrongly) consulted.
  assert.equal(await codeOf(urlSafety.validateUrl('http://8.8.8.8', quiet)), undefined);
});

// --- 3. DNS resolution + rebinding ------------------------------------------
test('a host resolving to a private IPv4 is PRIVATE_HOST (rebinding)', async () => {
  resolve4Impl = async () => ['127.0.0.1'];
  assert.equal(await codeOf(urlSafety.validateUrl('http://rebind.example', quiet)), 'PRIVATE_HOST');
});

test('every resolved address is checked — a private AAAA among public A is caught', async () => {
  resolve4Impl = async () => ['93.184.216.34'];
  resolve6Impl = async () => ['::1'];
  assert.equal(await codeOf(urlSafety.validateUrl('http://mixed.example', quiet)), 'PRIVATE_HOST');
});

test('an unresolvable host is UNRESOLVABLE_HOST', async () => {
  assert.equal(await codeOf(urlSafety.validateUrl('http://nope.example', quiet)), 'UNRESOLVABLE_HOST');
});

test('a host resolving only to public IPs passes', async () => {
  resolve4Impl = async () => ['93.184.216.34'];
  assert.equal(await codeOf(urlSafety.validateUrl('https://example.com', quiet)), undefined);
});

// --- 4. Self-referential -----------------------------------------------------
test('the short domain and its subdomains are SELF_REFERENTIAL', async () => {
  resolve4Impl = async () => ['93.184.216.34']; // routable unicast, so it reaches step 4
  assert.equal(await codeOf(urlSafety.validateUrl('https://klipo.to/abc', quiet)), 'SELF_REFERENTIAL');
  assert.equal(await codeOf(urlSafety.validateUrl('https://go.klipo.to/abc', quiet)), 'SELF_REFERENTIAL');
});

// --- 5. Domain blocklist -----------------------------------------------------
test('a blocked domain is BLOCKED_DOMAIN', async () => {
  db.__setClientsForTest({
    redis: makeFakeRedis() as unknown as import('ioredis').default,
    pool: makeFakePool({ blocked: true }) as unknown as import('pg').Pool,
  });
  // Public IP literal → skips DNS, reaches the blocklist query.
  assert.equal(await codeOf(urlSafety.validateUrl('http://8.8.8.8', quiet)), 'BLOCKED_DOMAIN');
});

// --- 6. Safe Browsing --------------------------------------------------------
test('a Safe Browsing match is MALICIOUS_URL', async () => {
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => okMatches([{ threatType: 'MALWARE' }]);
  assert.equal(await codeOf(urlSafety.validateUrl('https://malware.example', quiet)), 'MALICIOUS_URL');
});

test('Safe Browsing fails open on transport error', async () => {
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => {
    throw new Error('network down');
  };
  assert.equal(await codeOf(urlSafety.validateUrl('https://example.com', quiet)), undefined);
});

test('Safe Browsing fails open on a non-OK response', async () => {
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal(await codeOf(urlSafety.validateUrl('https://example.com', quiet)), undefined);
});

test('a cached SAFE verdict skips the API entirely', async () => {
  const url = 'https://cached-safe.example';
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => {
    throw new Error('fetch must not be called on a cache hit');
  };
  db.__setClientsForTest({
    redis: makeFakeRedis({ [sbKey(url)]: 'SAFE' }) as unknown as import('ioredis').default,
    pool: makeFakePool() as unknown as import('pg').Pool,
  });
  assert.equal(await codeOf(urlSafety.validateUrl(url, quiet)), undefined);
});

test('a cached MALICIOUS verdict rejects without calling the API', async () => {
  const url = 'https://cached-bad.example';
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => {
    throw new Error('fetch must not be called on a cache hit');
  };
  db.__setClientsForTest({
    redis: makeFakeRedis({ [sbKey(url)]: 'MALICIOUS' }) as unknown as import('ioredis').default,
    pool: makeFakePool() as unknown as import('pg').Pool,
  });
  assert.equal(await codeOf(urlSafety.validateUrl(url, quiet)), 'MALICIOUS_URL');
});

test('a fresh Safe Browsing verdict is cached with a 12h EX TTL', async () => {
  const url = 'https://fresh.example';
  resolve4Impl = async () => ['93.184.216.34'];
  fetchImpl = async () => okMatches([]); // clean
  const redis = makeFakeRedis();
  db.__setClientsForTest({
    redis: redis as unknown as import('ioredis').default,
    pool: makeFakePool() as unknown as import('pg').Pool,
  });
  assert.equal(await codeOf(urlSafety.validateUrl(url, quiet)), undefined);
  const sbSet = redis.setCalls.find((c) => String(c[0]).startsWith('klip:safebrowsing:'));
  assert.ok(sbSet, 'expected a safebrowsing cache write');
  assert.deepEqual(sbSet!.slice(1), ['SAFE', 'EX', 43200]); // 12h in seconds
});

// --- Trailing-dot FQDN normalization ----------------------------------------
test('a trailing-dot host is normalized (localhost. and short-domain.)', async () => {
  assert.equal(await codeOf(urlSafety.validateUrl('http://localhost./x', quiet)), 'PRIVATE_HOST');
  resolve4Impl = async () => ['93.184.216.34']; // reaches step 4
  assert.equal(await codeOf(urlSafety.validateUrl('https://klipo.to./x', quiet)), 'SELF_REFERENTIAL');
});
