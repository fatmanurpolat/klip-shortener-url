import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply, FastifyRequest } from 'fastify';

// Env must be set before env.ts (imported transitively) loads.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://klip:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.HASHIDS_SALT ??= 'test-salt';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789';

// -----------------------------------------------------------------------------
// Fakes
// -----------------------------------------------------------------------------
/** Fake redis whose eval reproduces the Lua counter ([allowed, remaining, ttl]). */
function makeFakeRedis() {
  const counts = new Map<string, number>();
  return {
    counts,
    async eval(_script: string, _numKeys: number, key: string, windowStr: string, limitStr: string) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const limit = Number(limitStr);
      const ttl = Number(windowStr);
      return n > limit ? [0, 0, ttl] : [1, limit - n, ttl];
    },
  };
}

const brokenRedis = {
  async eval() {
    throw new Error('connect ECONNREFUSED');
  },
};

function makeReq(over: Record<string, unknown> = {}): FastifyRequest {
  return {
    user: null,
    ip: '198.51.100.7',
    headers: {},
    log: { warn() {}, error() {}, info() {} },
    ...over,
  } as unknown as FastifyRequest;
}

function makeReply() {
  const state = { code: 0, headers: {} as Record<string, string>, payload: undefined as unknown };
  const reply = {
    code(c: number) {
      state.code = c;
      return reply;
    },
    header(k: string, v: unknown) {
      state.headers[k] = String(v);
      return reply;
    },
    send(p: unknown) {
      state.payload = p;
      return reply;
    },
  };
  return { reply: reply as unknown as FastifyReply, state };
}

let db: typeof import('../db.js');
let env: typeof import('../env.js').env;
let rl: typeof import('./rateLimit.js');

before(async () => {
  db = await import('../db.js');
  env = (await import('../env.js')).env;
  rl = await import('./rateLimit.js');
});

beforeEach(() => {
  env.TRUST_PROXY = false;
  db.__setClientsForTest({ redis: makeFakeRedis() as unknown as import('ioredis').default });
});

// --- getClientIp -------------------------------------------------------------
test('getClientIp ignores proxy headers unless TRUST_PROXY; then uses the attested (not spoofable) client', () => {
  // Attacker prepends "1.2.3.4"; nginx appends the real client → real = right-most.
  const spoofed = makeReq({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '1.2.3.4, 70.1.2.3' } });
  env.TRUST_PROXY = false;
  assert.equal(rl.getClientIp(spoofed), '10.0.0.1'); // header ignored entirely
  env.TRUST_PROXY = true;
  assert.equal(rl.getClientIp(spoofed), '70.1.2.3'); // right-most, NOT the spoofed 1.2.3.4

  // X-Real-IP (set by nginx to the real $remote_addr) takes precedence.
  const withReal = makeReq({
    ip: '10.0.0.1',
    headers: { 'x-real-ip': '203.0.113.8', 'x-forwarded-for': '1.2.3.4, 203.0.113.8' },
  });
  assert.equal(rl.getClientIp(withReal), '203.0.113.8');
});

// --- getLimitKey -------------------------------------------------------------
test('getLimitKey: shorten keys by IP when anon, by user when authenticated', () => {
  assert.equal(
    rl.getLimitKey(makeReq({ ip: '203.0.113.5', user: null }), 'shorten'),
    'klip:rl:shorten:anon:203.0.113.5',
  );
  assert.equal(
    rl.getLimitKey(makeReq({ user: { userId: 'user-1' } }), 'shorten'),
    'klip:rl:shorten:user:user-1',
  );
});

test('getLimitKey: auth and auth-verify share one per-IP key; redirect is its own', () => {
  const req = makeReq({ ip: '203.0.113.9' });
  assert.equal(rl.getLimitKey(req, 'auth'), 'klip:rl:auth:203.0.113.9');
  assert.equal(rl.getLimitKey(req, 'auth-verify'), 'klip:rl:auth:203.0.113.9');
  assert.equal(rl.getLimitKey(req, 'redirect'), 'klip:rl:redirect:203.0.113.9');
});

// --- rateLimit preHandler: allow / deny --------------------------------------
test('under the limit: passes through and sets X-RateLimit headers', async () => {
  const { reply, state } = makeReply();
  await rl.rateLimit('redirect', 600)(makeReq(), reply);
  assert.equal(state.code, 0); // handler not short-circuited
  assert.equal(state.headers['X-RateLimit-Limit'], '600');
  assert.equal(state.headers['X-RateLimit-Remaining'], '599');
  assert.ok(Number(state.headers['X-RateLimit-Reset']) > 0);
});

test('over the limit: 429 with Retry-After and rate_limited body', async () => {
  const pre = rl.rateLimit('auth', 1); // limit 1 → 2nd call denied
  const req = makeReq({ ip: '203.0.113.50' });
  const first = makeReply();
  await pre(req, first.reply);
  assert.equal(first.state.code, 0);
  const second = makeReply();
  await pre(req, second.reply);
  assert.equal(second.state.code, 429);
  assert.equal((second.state.payload as { error: string }).error, 'rate_limited');
  assert.ok(Number(second.state.headers['Retry-After']) > 0);
  assert.equal(second.state.headers['X-RateLimit-Remaining'], '0');
});

test('shorten selects the authed limit (120) and user key; anon uses 10', async () => {
  const redis = makeFakeRedis();
  db.__setClientsForTest({ redis: redis as unknown as import('ioredis').default });
  const authed = makeReply();
  await rl.rateLimit('shorten', 10, 120)(makeReq({ user: { userId: 'u9' } }), authed.reply);
  assert.equal(authed.state.headers['X-RateLimit-Limit'], '120');
  assert.equal(authed.state.headers['X-RateLimit-Remaining'], '119');
  assert.ok(redis.counts.has('klip:rl:shorten:user:u9'));

  const anon = makeReply();
  await rl.rateLimit('shorten', 10, 120)(makeReq({ ip: '203.0.113.77', user: null }), anon.reply);
  assert.equal(anon.state.headers['X-RateLimit-Limit'], '10');
  assert.ok(redis.counts.has('klip:rl:shorten:anon:203.0.113.77'));
});

// --- fail strategy -----------------------------------------------------------
test('redirect FAILS OPEN when Redis is unavailable', async () => {
  db.__setClientsForTest({ redis: brokenRedis as unknown as import('ioredis').default });
  const { reply, state } = makeReply();
  await rl.rateLimit('redirect', 600)(makeReq(), reply);
  assert.equal(state.code, 0); // allowed through
  assert.equal(state.payload, undefined);
});

test('shorten FAILS CLOSED (503) when Redis is unavailable', async () => {
  db.__setClientsForTest({ redis: brokenRedis as unknown as import('ioredis').default });
  const { reply, state } = makeReply();
  await rl.rateLimit('shorten', 10, 120)(makeReq(), reply);
  assert.equal(state.code, 503);
  assert.equal((state.payload as { error: string }).error, 'service_unavailable');
});

test('auth FAILS CLOSED (503) when Redis is unavailable', async () => {
  db.__setClientsForTest({ redis: brokenRedis as unknown as import('ioredis').default });
  const { reply, state } = makeReply();
  await rl.rateLimit('auth', 5)(makeReq(), reply);
  assert.equal(state.code, 503);
  assert.equal((state.payload as { error: string }).error, 'service_unavailable');
});

// --- IP bucketing & validation -----------------------------------------------
test('IPv6 clients are bucketed to a /64 so a prefix cannot be rotated for new keys', () => {
  env.TRUST_PROXY = true;
  const key = (realIp: string) =>
    rl.getLimitKey(makeReq({ headers: { 'x-real-ip': realIp } }), 'redirect');
  const a = key('2001:db8:1:2::5');
  const b = key('2001:db8:1:2::abcd'); // same /64
  const other = key('2001:db8:1:3::5'); // different /64
  assert.equal(a, b, 'addresses in one /64 must share a bucket');
  assert.notEqual(a, other, 'different /64s must not share a bucket');
  assert.ok(a.startsWith('klip:rl:redirect:') && a.endsWith('/64'), `unexpected key: ${a}`);
});

test('IPv4 clients are keyed by exact address', () => {
  env.TRUST_PROXY = true;
  const req = makeReq({ headers: { 'x-real-ip': '203.0.113.42' } });
  assert.equal(rl.getLimitKey(req, 'redirect'), 'klip:rl:redirect:203.0.113.42');
});

test('a non-IP proxy header is rejected and falls back to req.ip', () => {
  env.TRUST_PROXY = true;
  const req = makeReq({ ip: '203.0.113.9', headers: { 'x-real-ip': 'not-an-ip; DROP', 'x-forwarded-for': 'garbage' } });
  assert.equal(rl.getClientIp(req), '203.0.113.9');
});

test('reset is clamped to >= 1s so Reset and Retry-After never advertise 0/now', async () => {
  // Redis reports ttl 0 (last fractional second of the window).
  let n = 0;
  const redis = {
    async eval() {
      n += 1;
      return n > 1 ? [0, 0, 0] : [1, 5, 0];
    },
  };
  db.__setClientsForTest({ redis: redis as unknown as import('ioredis').default });
  const nowFloor = Math.floor(Date.now() / 1000);

  const ok = makeReply();
  await rl.rateLimit('redirect', 600)(makeReq(), ok.reply);
  assert.ok(Number(ok.state.headers['X-RateLimit-Reset']) >= nowFloor + 1);

  const denied = makeReply();
  await rl.rateLimit('redirect', 600)(makeReq(), denied.reply);
  assert.equal(denied.state.code, 429);
  assert.equal(denied.state.headers['Retry-After'], '1');
});
