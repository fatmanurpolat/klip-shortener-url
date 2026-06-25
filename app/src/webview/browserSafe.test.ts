import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBrowserSafeUrl, isAppHandoffUrl } from './browserSafe';

const CASES: Array<{ name: string; input: string; expected: string }> = [
  {
    name: 'Instagram post → embed (strips tracking query)',
    input: 'https://www.instagram.com/p/DaAFxKEiPLq/?utm_source=ig_web_copy_link&igsh=NTc4',
    expected: 'https://www.instagram.com/p/DaAFxKEiPLq/embed/captioned/',
  },
  {
    name: 'Instagram reel → embed',
    input: 'https://www.instagram.com/reel/ABC123/',
    expected: 'https://www.instagram.com/reel/ABC123/embed/captioned/',
  },
  {
    name: 'Instagram without www → embed',
    input: 'https://instagram.com/p/XYZ/',
    expected: 'https://www.instagram.com/p/XYZ/embed/captioned/',
  },
  {
    name: 'Instagram embed is idempotent',
    input: 'https://www.instagram.com/p/XYZ/embed/captioned/',
    expected: 'https://www.instagram.com/p/XYZ/embed/captioned/',
  },
  {
    name: 'Instagram profile (no post) → unchanged',
    input: 'https://www.instagram.com/someuser/',
    expected: 'https://www.instagram.com/someuser/',
  },
  {
    name: 'TikTok video → embed',
    input: 'https://www.tiktok.com/@user/video/7412345678901234567?lang=en',
    expected: 'https://www.tiktok.com/embed/v2/7412345678901234567',
  },
  {
    name: 'TikTok short link → unchanged (no video id)',
    input: 'https://vm.tiktok.com/ZMabc123/',
    expected: 'https://vm.tiktok.com/ZMabc123/',
  },
  {
    name: 'Unrelated URL → unchanged',
    input: 'https://example.com/path?x=1',
    expected: 'https://example.com/path?x=1',
  },
  {
    name: 'Malformed URL → unchanged',
    input: 'not a url',
    expected: 'not a url',
  },
];

for (const c of CASES) {
  test(`toBrowserSafeUrl: ${c.name}`, () => {
    assert.equal(toBrowserSafeUrl(c.input), c.expected);
  });
}

const HANDOFF_CASES: Array<{ name: string; input: string; expected: boolean }> = [
  { name: 'instagram embed is handoff domain', input: 'https://www.instagram.com/p/X/embed/captioned/', expected: true },
  { name: 'instagram without www', input: 'https://instagram.com/someuser/', expected: true },
  { name: 'tiktok embed is handoff domain', input: 'https://www.tiktok.com/embed/v2/123', expected: true },
  { name: 'plain site is not handoff', input: 'https://example.com/p/X', expected: false },
  { name: 'malformed is not handoff', input: 'nope', expected: false },
];

for (const c of HANDOFF_CASES) {
  test(`isAppHandoffUrl: ${c.name}`, () => {
    assert.equal(isAppHandoffUrl(c.input), c.expected);
  });
}
