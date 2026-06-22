import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectWebview, WebviewInfo } from './detect';

const CASES: Array<{ name: string; ua: string; expected: WebviewInfo }> = [
  {
    name: 'Instagram Android',
    ua: 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Mobile Safari/537.36 Instagram 267.0.0.18.100 Android (31/12; 420dpi; 1080x2142; samsung; SM-G991B; o1q; exynos2100; en_US; 435912859)',
    expected: { isWebview: true, network: 'instagram', platform: 'android' },
  },
  {
    name: 'Facebook iOS (in-app)',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/20C65 [FBAN/FBIOS;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/16.2;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5]',
    expected: { isWebview: true, network: 'facebook', platform: 'ios' },
  },
  {
    name: 'TikTok Android',
    ua: 'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Mobile Safari/537.36 TikTok/14.2.4 (Cronet)',
    expected: { isWebview: true, network: 'tiktok', platform: 'android' },
  },
  {
    name: 'Chrome desktop',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    expected: { isWebview: false, network: null, platform: 'other' },
  },
  {
    name: 'Mobile Safari iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    expected: { isWebview: false, network: null, platform: 'ios' },
  },
  {
    name: 'Plain Android Chrome (must NOT match Line)',
    ua: 'Mozilla/5.0 (Linux; Android 9; Moto G7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.117 Mobile Safari/537.36',
    expected: { isWebview: false, network: null, platform: 'android' },
  },
];

for (const c of CASES) {
  test(c.name, () => {
    assert.deepEqual(detectWebview(c.ua), c.expected);
  });
}

// Extra guards for the trickier rules.
test('Line in-app webview matches', () => {
  const ua =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0';
  assert.deepEqual(detectWebview(ua), { isWebview: true, network: 'line', platform: 'ios' });
});

test('"Lineage" / "Baseline" do not trigger the Line rule', () => {
  assert.equal(detectWebview('SomeApp Lineage/1.0').isWebview, false);
  assert.equal(detectWebview('Mozilla Baseline/2.0').isWebview, false);
});

test('Snapchat matches', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 13) Snapchat/12.0.0 (SM-S901B; Android 13)';
  assert.deepEqual(detectWebview(ua), { isWebview: true, network: 'snapchat', platform: 'android' });
});

test('generic Android WebView (; wv) is the catch-all', () => {
  const ua =
    'Mozilla/5.0 (Linux; Android 10; HD1913; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/83.0.4103.106 Mobile Safari/537.36';
  assert.deepEqual(detectWebview(ua), { isWebview: true, network: 'generic', platform: 'android' });
});

test('empty user-agent is safe', () => {
  assert.deepEqual(detectWebview(''), { isWebview: false, network: null, platform: 'other' });
});
