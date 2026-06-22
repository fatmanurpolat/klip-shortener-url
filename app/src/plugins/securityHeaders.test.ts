import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { securityHeaders } from './securityHeaders';

// The 6 headers the plugin injects. Asserted present on non-redirects and
// absent on plain redirects. (No env/DB/Redis needed — the plugin imports none;
// we drive it with app.inject against tiny stand-in routes.)
const SECURITY_HEADERS = [
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'x-xss-protection',
  'content-security-policy',
  'permissions-policy',
];

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(securityHeaders);
  app.get('/ok', async (_req, reply) => reply.send({ ok: true })); // 200 JSON (API)
  app.get('/html', async (_req, reply) => reply.type('text/html').send('<!doctype html><p>hi')); // 200 HTML (interstitial-like)
  app.get('/missing', async (_req, reply) => reply.code(404).send({ error: 'not_found' })); // 404 page
  app.get('/go302', async (_req, reply) => reply.redirect('https://example.com/dest', 302)); // /:code redirect
  app.get('/go301', async (_req, reply) => reply.redirect('https://example.com/dest', 301));
  await app.ready();
  return app;
}

test('security headers are present on a 200 JSON response', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/ok' });
  assert.equal(res.statusCode, 200);
  for (const h of SECURITY_HEADERS) assert.ok(res.headers[h], `missing ${h}`);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-xss-protection'], '0');
  assert.match(String(res.headers['content-security-policy']), /frame-ancestors 'none'/);
  await app.close();
});

test('security headers are present on a 200 HTML page (interstitial-like)', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/html' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.ok(res.headers['content-security-policy']);
  await app.close();
});

test('security headers are present on a 404 response', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/missing' });
  assert.equal(res.statusCode, 404);
  assert.ok(res.headers['content-security-policy']);
  await app.close();
});

test('security headers are SKIPPED on a 302 redirect (only Location)', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/go302' });
  assert.equal(res.statusCode, 302);
  assert.ok(res.headers['location']);
  for (const h of SECURITY_HEADERS) {
    assert.equal(res.headers[h], undefined, `${h} must be absent on a redirect`);
  }
  await app.close();
});

test('security headers are SKIPPED on a 301 redirect', async () => {
  const app = await buildTestApp();
  const res = await app.inject({ method: 'GET', url: '/go301' });
  assert.equal(res.statusCode, 301);
  for (const h of SECURITY_HEADERS) assert.equal(res.headers[h], undefined);
  await app.close();
});

test('a header a route set itself is not clobbered by the hook', async () => {
  const app = Fastify();
  await app.register(securityHeaders);
  app.get('/custom', async (_req, reply) => reply.header('X-Frame-Options', 'SAMEORIGIN').send('ok'));
  await app.ready();
  const res = await app.inject({ method: 'GET', url: '/custom' });
  assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
  await app.close();
});
