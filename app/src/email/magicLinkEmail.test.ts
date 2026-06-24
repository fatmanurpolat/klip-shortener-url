import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMagicLinkEmail, humanizeTtl } from './magicLinkEmail';

test('buildMagicLinkEmail includes the link in href and text', () => {
  const link = 'https://klipo.to/api/v1/auth/verify?token=abc.def.ghi';
  const { subject, html, text } = buildMagicLinkEmail(link, '15m');

  assert.match(subject, /sign-in/i);
  assert.ok(html.includes(`href="${link}"`), 'html anchors the raw link');
  assert.ok(text.includes(link), 'text body contains the link');
  assert.match(text, /15 minutes/);
  assert.match(text, /only be used once/i);
});

test('buildMagicLinkEmail reflects the configured TTL in the copy', () => {
  const link = 'https://klipo.to/api/v1/auth/verify?token=x';
  const { text, html } = buildMagicLinkEmail(link, '24h');
  assert.match(text, /expires in 24 hours/);
  assert.match(html, /expires in 24 hours/);
  assert.ok(!text.includes('15 minutes'), 'stale 15-minute copy must be gone');
});

test('humanizeTtl turns ms-strings into words', () => {
  assert.equal(humanizeTtl('15m'), '15 minutes');
  assert.equal(humanizeTtl('1h'), '1 hour');
  assert.equal(humanizeTtl('24h'), '24 hours');
  assert.equal(humanizeTtl('7d'), '7 days');
  assert.equal(humanizeTtl('1d'), '1 day');
  assert.equal(humanizeTtl('weird'), 'weird', 'falls back to the raw value');
});

test('buildMagicLinkEmail HTML-escapes the link so a token cannot break the attribute', () => {
  // A token can be base64url (no quotes), but defend against any injected quote/angle.
  const link = 'https://klipo.to/api/v1/auth/verify?token=a"b<c>&d\'e';
  const { html } = buildMagicLinkEmail(link);

  assert.ok(!html.includes('token=a"b'), 'raw double-quote must not appear in href');
  assert.ok(html.includes('&quot;'), 'double-quote is escaped');
  assert.ok(html.includes('&lt;') && html.includes('&gt;'), 'angle brackets are escaped');
  assert.ok(html.includes('&amp;'), 'ampersand is escaped');
  assert.ok(html.includes('&#39;'), 'single-quote is escaped');
});
