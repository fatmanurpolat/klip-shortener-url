import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// env.ts validates on import; set the required vars first.
process.env.HASHIDS_SALT ??= 'test-salt';
process.env.SESSION_SECRET ??= 'test-session-secret-0123456789';
process.env.DATABASE_URL ??= 'postgres://klip:test@localhost:5432/klip';
process.env.REDIS_URL ??= 'redis://localhost:6379';

let geoip: typeof import('./geoip.js');

before(async () => {
  geoip = await import('./geoip.js');
});

test('hashIp returns a 32-byte Buffer', () => {
  const h = geoip.hashIp('1.2.3.4');
  assert.ok(Buffer.isBuffer(h));
  assert.equal(h.length, 32);
});

test('hashIp truncates IPv4 to /24', () => {
  const d = new Date('2026-06-22T10:00:00Z');
  // Same /24 → same hash; different /24 → different hash.
  assert.deepEqual(geoip.hashIp('1.2.3.4', d), geoip.hashIp('1.2.3.250', d));
  assert.notDeepEqual(geoip.hashIp('1.2.3.4', d), geoip.hashIp('1.2.9.4', d));
});

test('hashIp rotates daily', () => {
  const a = geoip.hashIp('1.2.3.4', new Date('2026-06-22T00:00:00Z'));
  const b = geoip.hashIp('1.2.3.4', new Date('2026-06-23T00:00:00Z'));
  assert.notDeepEqual(a, b);
});

test('getCountry: public IP → ISO code, private/local → ""', () => {
  assert.equal(geoip.getCountry('8.8.8.8'), 'US');
  assert.equal(geoip.getCountry('10.0.0.1'), '');
  assert.equal(geoip.getCountry('127.0.0.1'), '');
  assert.equal(geoip.getCountry(''), '');
});
