import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUA } from './ua';

test('desktop Chrome → desktop', () => {
  const r = parseUA(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  assert.equal(r.browser, 'Chrome');
  assert.equal(r.device, 'desktop');
  assert.ok(/mac/i.test(r.os), `os was ${r.os}`);
});

test('iPhone Safari → mobile / iOS', () => {
  const r = parseUA(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  );
  assert.equal(r.os, 'iOS');
  assert.equal(r.device, 'mobile');
});

test('iPad → tablet', () => {
  const r = parseUA(
    'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  );
  assert.equal(r.device, 'tablet');
});

test('Android Chrome → mobile / Android', () => {
  const r = parseUA(
    'Mozilla/5.0 (Linux; Android 12; Pixel 6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36',
  );
  assert.equal(r.os, 'Android');
  assert.equal(r.device, 'mobile');
});

test('Googlebot → bot', () => {
  const r = parseUA('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
  assert.equal(r.device, 'bot');
});

test('empty UA → desktop with empty fields', () => {
  const r = parseUA('');
  assert.equal(r.device, 'desktop');
  assert.equal(r.browser, '');
  assert.equal(r.os, '');
});
