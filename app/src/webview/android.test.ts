import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAndroidIntentUrl, buildAndroidEscapePage } from './android';

test('intent URL starts with intent://{host}{path}', () => {
  const out = buildAndroidIntentUrl('https://example.com/path?q=1&r=2');
  assert.ok(out.startsWith('intent://example.com/path'), out);
});

test('intent URL targets stable Chrome', () => {
  const out = buildAndroidIntentUrl('https://example.com/path?q=1&r=2');
  assert.ok(out.includes('package=com.android.chrome'), out);
});

test('intent URL carries the percent-encoded fallback', () => {
  const out = buildAndroidIntentUrl('https://example.com/path?q=1&r=2');
  assert.ok(out.includes('S.browser_fallback_url=https%3A%2F%2Fexample.com%2Fpath'), out);
});

test('intent URL ends with ;end', () => {
  const out = buildAndroidIntentUrl('https://example.com/path?q=1&r=2');
  assert.ok(out.endsWith(';end'), out);
});

test('root URL produces the exact expected intent string', () => {
  assert.equal(
    buildAndroidIntentUrl('https://example.com'),
    'intent://example.com#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fexample.com;end',
  );
});

test('special characters in the query are correctly encoded in the fallback', () => {
  const input = 'https://example.com/search?q=hello world&filter=a/b&u=x+y';
  const out = buildAndroidIntentUrl(input);
  // Fallback is encodeURIComponent of the whole original URL.
  assert.ok(out.endsWith(`S.browser_fallback_url=${encodeURIComponent(input)};end`), out);
  // Sanity: dangerous chars are percent-encoded, not raw, in the fallback.
  const fallback = out.slice(out.indexOf('S.browser_fallback_url=') + 'S.browser_fallback_url='.length, -';end'.length);
  assert.ok(!fallback.includes(' '), 'space must be encoded');
  assert.ok(!fallback.includes('&'), 'ampersand must be encoded');
});

// ---- HTML escape page ----
test('escape page embeds the intent URL and is self-contained', () => {
  const html = buildAndroidEscapePage('https://example.com/path?q=1', 'instagram');
  const intent = buildAndroidIntentUrl('https://example.com/path?q=1');

  assert.ok(html.includes('window.location.href'), 'navigates via JS');
  assert.ok(html.includes(intent.replace(/&/g, '&')), 'contains the intent URL'); // JSON-embedded
  assert.ok(html.includes('data-network="instagram"'), 'sets data-network');
  assert.ok(/Open in browser/i.test(html), 'shows fallback instructions');

  // No external resources.
  assert.ok(!/<script[^>]+\bsrc=/i.test(html), 'no external script');
  assert.ok(!/<link\b/i.test(html), 'no external stylesheet');
  assert.ok(!/https?:\/\/[^"'\s)]+\.(js|css)/i.test(html), 'no CDN asset URLs');
});

test('escape page falls back to a generic network label', () => {
  const html = buildAndroidEscapePage('https://example.com', '');
  assert.ok(html.includes('data-network="generic"'), html);
});
