/**
 * Rewrite Instagram/TikTok post URLs to their browser-only "embed" form.
 *
 * On iOS/Android, tapping a canonical instagram.com / tiktok.com post URL is
 * captured by the OS (Universal Links / App Links) and handed straight to the
 * native app — which defeats the whole point of escaping into a real browser
 * (and produces a Safari→app→Safari bounce loop when the user keeps trying).
 *
 * The apps' association files do NOT claim their `/embed` paths, so an embed
 * URL renders the post inside the browser and never launches the app. We only
 * apply this on mobile platforms, where the app-handoff happens; desktop keeps
 * the full canonical page.
 *
 * Anything we don't recognize is returned unchanged.
 */
export function toBrowserSafeUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  const host = u.hostname.replace(/^www\./i, '').toLowerCase();

  // Instagram posts/reels/tv → /embed/captioned/ (browser-only render).
  // Idempotent: an URL that already ends in /embed re-matches to the same form.
  if (host === 'instagram.com') {
    const m = u.pathname.match(/^\/(p|reel|tv)\/([^/]+)/i);
    if (m) {
      return `https://www.instagram.com/${m[1].toLowerCase()}/${m[2]}/embed/captioned/`;
    }
    return rawUrl;
  }

  // TikTok videos → /embed/v2/{id} (browser-only render). Short links
  // (vm./vt.tiktok.com) carry no video id, so we leave them untouched.
  if (host === 'tiktok.com') {
    const m = u.pathname.match(/\/video\/(\d+)/);
    if (m) {
      return `https://www.tiktok.com/embed/v2/${m[1]}`;
    }
    return rawUrl;
  }

  return rawUrl;
}

/**
 * True when a URL points at a domain that iOS Universal Links / Android App
 * Links will hand to a native app. On mobile these must be reached via a
 * script-driven redirect (see softRedirect.ts), never a server 3xx, or the OS
 * yanks the user into the app.
 */
export function isAppHandoffUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./i, '').toLowerCase();
  return host === 'instagram.com' || host === 'tiktok.com';
}
