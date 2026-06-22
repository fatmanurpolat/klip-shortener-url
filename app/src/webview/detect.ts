/**
 * Webview detection. Called on the redirect hot path to decide between a plain
 * redirect and a webview-escape interstitial.
 *
 * Network detection is ordered most-specific first; the generic Android
 * WebView (`; wv`) is the last-resort catch-all. Platform is detected
 * independently of the network.
 */

export type WebviewInfo = {
  isWebview: boolean;
  network: 'instagram' | 'facebook' | 'tiktok' | 'line' | 'snapchat' | 'generic' | null;
  platform: 'android' | 'ios' | 'other';
};

type Network = NonNullable<WebviewInfo['network']>;

// Order matters: most specific first, generic Android WebView last.
const NETWORK_PATTERNS: ReadonlyArray<{ network: Network; pattern: RegExp }> = [
  { network: 'instagram', pattern: /Instagram/i },
  { network: 'facebook', pattern: /FBAN|FBAV|FB_IAB/i },
  { network: 'tiktok', pattern: /TikTok|musical_ly|BytedanceWebview/i },
  // Space before "Line" and slash after, so "Lineage"/"Baseline" don't match.
  { network: 'line', pattern: / Line\//i },
  { network: 'snapchat', pattern: /Snapchat/i },
  // Catch-all: any Android WebView not matched above.
  { network: 'generic', pattern: /; wv/i },
];

function detectPlatform(ua: string): WebviewInfo['platform'] {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export function detectWebview(userAgent: string): WebviewInfo {
  const ua = userAgent ?? '';
  const platform = detectPlatform(ua);

  for (const { network, pattern } of NETWORK_PATTERNS) {
    if (pattern.test(ua)) {
      return { isWebview: true, network, platform };
    }
  }

  return { isWebview: false, network: null, platform };
}
