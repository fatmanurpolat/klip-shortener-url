import { test, before } from 'node:test';
import assert from 'node:assert/strict';
// Type-only imports (erased at runtime, so they DON'T trigger env loading).
import type { ShortenDeps, ShortenInput } from './ShortenLinkUseCase';
import type { IdGenerator, UrlValidator, Cache } from '../../ports';

// env loads transitively (domain/codes → HASHIDS_SALT; security/urlSafety → env).
// Set it top-of-file so env.ts doesn't exit(1); module is loaded in before().
process.env.NODE_ENV = 'test';
process.env.COUNTER_OFFSET = '0';
process.env.HASHIDS_SALT ??= 'test-salt-0123456789-abcdef';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789-abcdef';
process.env.DATABASE_URL ??= 'postgres://klipo:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';

let createShortenLinkUseCase: typeof import('./ShortenLinkUseCase.js').createShortenLinkUseCase;
let UrlSafetyError: typeof import('../../security/urlSafety.js').UrlSafetyError;

before(async () => {
  ({ createShortenLinkUseCase } = await import('./ShortenLinkUseCase.js'));
  ({ UrlSafetyError } = await import('../../security/urlSafety.js'));
});

const quiet = { warn() {}, error() {} };

// --- In-memory fake ports (no DB / Redis / HTTP) ---
function makeFakeRepo(
  opts: {
    activeCount?: number;
    takenAliases?: Set<string>;
    countThrows?: boolean;
    createThrows?: boolean;
  } = {},
) {
  const created: Array<{ shortCode: string; isCustomAlias: boolean }> = [];
  return {
    created,
    async countActiveLinks(): Promise<number> {
      if (opts.countThrows) throw new Error('db down');
      return opts.activeCount ?? 0;
    },
    async createLink(link: { shortCode: string; isCustomAlias: boolean }) {
      if (opts.createThrows) throw new Error('tx failed');
      if (link.isCustomAlias && opts.takenAliases?.has(link.shortCode)) {
        return { ok: false as const, reason: 'alias_taken' as const };
      }
      created.push(link);
      return { ok: true as const };
    },
  };
}

interface HarnessOver {
  links?: ReturnType<typeof makeFakeRepo>;
  ids?: IdGenerator;
  validator?: UrlValidator;
  cache?: Cache;
}

function makeHarness(over: HarnessOver = {}) {
  const cacheCalls: Array<[string, string]> = [];
  const auditCalls: Array<{ shortCode: string }> = [];
  let n = 0n;
  const repo = over.links ?? makeFakeRepo();
  const deps: ShortenDeps = {
    links: repo,
    ids: over.ids ?? { async nextId() { n += 1n; return n; } },
    codec: { encode: (seq) => `code${seq}` },
    cache: over.cache ?? { async cacheUrl(c, u) { cacheCalls.push([c, u]); } },
    validator: over.validator ?? { async validate() {} },
    audit: { record: (e) => auditCalls.push(e) },
    clock: { now: () => new Date('2026-06-24T00:00:00.000Z') },
  };
  return { deps, cacheCalls, auditCalls, repo };
}

function makeInput(over: Partial<ShortenInput> = {}): ShortenInput {
  return {
    url: 'https://example.com',
    expiresAt: null,
    private: false,
    analytics: true,
    ownerId: null,
    ipPrefix: '203.0.113.0/24',
    log: quiet,
    ...over,
  };
}

test('happy path: mints code, persists, caches, audits', async () => {
  const h = makeHarness();
  const res = await createShortenLinkUseCase(h.deps)(makeInput());
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.value.shortCode, 'code1');
    assert.equal(res.value.longUrl, 'https://example.com');
    assert.equal(res.value.createdAt.toISOString(), '2026-06-24T00:00:00.000Z');
  }
  assert.equal(h.repo.created.length, 1);
  assert.deepEqual(h.cacheCalls, [['code1', 'https://example.com']]);
  assert.equal(h.auditCalls.length, 1);
});

test('private link with no owner → auth_required (no persist)', async () => {
  const h = makeHarness();
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ private: true, ownerId: null }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'auth_required');
  assert.equal(h.repo.created.length, 0);
});

test('reserved alias → reserved_alias', async () => {
  const h = makeHarness();
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ customAlias: 'Admin' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'reserved_alias');
});

test('unsafe url → unsafe_url carrying the UrlSafetyError', async () => {
  const validator = { async validate() { throw new UrlSafetyError('BLOCKED_DOMAIN', 'blocked'); } };
  const h = makeHarness({ validator });
  const res = await createShortenLinkUseCase(h.deps)(makeInput());
  assert.equal(res.ok, false);
  if (!res.ok && res.error.kind === 'unsafe_url') {
    assert.equal(res.error.error.code, 'BLOCKED_DOMAIN');
  } else {
    assert.fail('expected unsafe_url');
  }
});

test('over quota (anon at 100) → quota_exceeded', async () => {
  const h = makeHarness({ links: makeFakeRepo({ activeCount: 100 }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ ownerId: null }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'quota_exceeded');
});

test('over quota (signed-in user at 1000) → quota_exceeded', async () => {
  const h = makeHarness({ links: makeFakeRepo({ activeCount: 1000 }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ ownerId: 'user-1' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'quota_exceeded');
});

test('signed-in user just under the cap (999) → allowed', async () => {
  const h = makeHarness({ links: makeFakeRepo({ activeCount: 999 }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ ownerId: 'user-1' }));
  assert.equal(res.ok, true);
});

test('quota is configurable: an injected auth cap of 3 blocks at 3', async () => {
  const h = makeHarness({ links: makeFakeRepo({ activeCount: 3 }) });
  const deps = { ...h.deps, quotas: { anon: 100, auth: 3 } };
  const res = await createShortenLinkUseCase(deps)(makeInput({ ownerId: 'user-1' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'quota_exceeded');
});

test('quota count error → quota_unavailable (fail closed)', async () => {
  const h = makeHarness({ links: makeFakeRepo({ countThrows: true }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput());
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'quota_unavailable');
});

test('counter error → counter_unavailable', async () => {
  const ids = { async nextId(): Promise<bigint> { throw new Error('counter down'); } };
  const h = makeHarness({ ids });
  const res = await createShortenLinkUseCase(h.deps)(makeInput());
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'counter_unavailable');
});

test('alias collision → alias_taken', async () => {
  const h = makeHarness({ links: makeFakeRepo({ takenAliases: new Set(['mine']) }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ customAlias: 'mine' }));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'alias_taken');
});

test('persist failure → persist_failed', async () => {
  const h = makeHarness({ links: makeFakeRepo({ createThrows: true }) });
  const res = await createShortenLinkUseCase(h.deps)(makeInput());
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.error.kind, 'persist_failed');
});

test('private link is NOT cached', async () => {
  const h = makeHarness();
  const res = await createShortenLinkUseCase(h.deps)(makeInput({ private: true, ownerId: 'u1' }));
  assert.equal(res.ok, true);
  assert.equal(h.cacheCalls.length, 0);
});

test('a non-UrlSafetyError from the validator propagates (route maps to 500)', async () => {
  const validator = { async validate() { throw new Error('boom'); } };
  const h = makeHarness({ validator });
  await assert.rejects(() => createShortenLinkUseCase(h.deps)(makeInput()), /boom/);
});
