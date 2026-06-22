import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIosEscapePage } from './ios';

test('attempts the x-safari-https scheme immediately', () => {
  const html = buildIosEscapePage('https://example.com/p?q=1', 'instagram');
  assert.ok(html.includes('"x-safari-https://"'), 'uses x-safari-https scheme');
  assert.ok(/LONG_URL\.replace\(\/\^https\?/.test(html), 'strips the scheme from the URL at runtime');
});

test('reveals manual instructions after 1200ms', () => {
  const html = buildIosEscapePage('https://example.com', 'instagram');
  assert.ok(/setTimeout\([\s\S]*?1200\)/.test(html), 'has a 1200ms timeout');
  assert.ok(html.includes('classList.add("escape-failed")'), 'adds escape-failed');
});

test('per-network instruction text + data-network', () => {
  const ig = buildIosEscapePage('https://example.com', 'instagram');
  assert.ok(ig.includes('data-network="instagram"'));
  assert.ok(ig.includes("Open in external browser"), 'instagram → external browser wording');

  const fb = buildIosEscapePage('https://example.com', 'facebook');
  assert.ok(fb.includes('data-network="facebook"'));
  assert.ok(/Open in browser/.test(fb));

  const gen = buildIosEscapePage('https://example.com', 'generic');
  assert.ok(gen.includes('data-network="generic"'));
  // apostrophe is HTML-escaped (&#39;), so match the unescaped prefix.
  assert.ok(gen.includes('Tap your browser'));
});

test('unknown network falls back to generic', () => {
  const html = buildIosEscapePage('https://example.com', 'mystery');
  assert.ok(html.includes('data-network="generic"'));
});

test('arrow shown for named networks, hidden for generic', () => {
  assert.ok(buildIosEscapePage('https://example.com', 'tiktok').includes('class="arrow"'), 'tiktok shows arrow');
  assert.ok(!buildIosEscapePage('https://example.com', 'generic').includes('class="arrow"'), 'generic has no arrow element');
  // CSS guard hides it even if present.
  assert.ok(buildIosEscapePage('https://example.com', 'generic').includes('[data-network="generic"] .arrow'));
});

test('copy button is a real <button>, accessible, uses clipboard API', () => {
  const html = buildIosEscapePage('https://example.com', 'instagram');
  assert.ok(/<button[^>]*id="copy"/.test(html), 'is a <button>');
  assert.ok(html.includes('aria-label="Copy link to clipboard"'));
  assert.ok(html.includes('>Copy link<'));
  assert.ok(html.includes('navigator.clipboard.writeText'));
  assert.ok(html.includes('"Copied!"'));
});

test('accessibility/contrast basics: reduced-motion + 16px base', () => {
  const html = buildIosEscapePage('https://example.com', 'instagram');
  assert.ok(html.includes('prefers-reduced-motion: reduce'));
  assert.ok(html.includes('font-size: 16px'));
});

test('no external resources', () => {
  const html = buildIosEscapePage('https://example.com', 'instagram');
  assert.ok(!/<script[^>]+\bsrc=/i.test(html), 'no external script');
  assert.ok(!/<link\b/i.test(html), 'no external stylesheet');
  assert.ok(!/https?:\/\/[^"'\s)]+\.(js|css)/i.test(html), 'no CDN assets');
});

test('malicious URL cannot break out of the inline script', () => {
  const evil = 'https://example.com/x"></script><script>alert(1)</script>';
  const html = buildIosEscapePage(evil, 'instagram');
  // The injected </script> from the URL must be neutralised (escaped to \\u003c).
  assert.ok(!html.includes('</script><script>alert(1)'), 'no raw injected script tag');
  assert.ok(html.includes('\\u003c/script'), 'angle bracket escaped in the JS literal');
});
