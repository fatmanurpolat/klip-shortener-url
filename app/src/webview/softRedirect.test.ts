import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSoftRedirectPage } from './softRedirect';

const DEST = 'https://www.instagram.com/p/DaAFxKEiPLq/embed/captioned/';

test('uses gesture-less location.replace to the destination', () => {
  const html = buildSoftRedirectPage(DEST);
  assert.match(html, /window\.location\.replace\(/);
  assert.ok(html.includes(JSON.stringify(DEST)), 'destination embedded as a JS string literal');
});

test('provides a no-JS fallback link', () => {
  const html = buildSoftRedirectPage(DEST);
  assert.match(html, /<noscript>/);
  assert.ok(html.includes(`href="${DEST}"`), 'fallback anchor points at destination');
});

test('no external resources', () => {
  const html = buildSoftRedirectPage(DEST);
  assert.doesNotMatch(html, /src=|<link/);
});

test('a malicious URL cannot break out of the inline script', () => {
  const evil = 'https://x.test/"></script><script>alert(1)</script>';
  const html = buildSoftRedirectPage(evil);
  // The "<" of any injected "</script>" is escaped inside the JS literal.
  assert.doesNotMatch(html, /<\/script><script>alert/);
});
