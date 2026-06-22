/**
 * Android webview escape.
 *
 * In-app browsers (Instagram, TikTok, Facebook, …) trap the user. On Android we
 * can break out by navigating to an `intent://` URL that asks Android to open
 * the destination in Chrome, with a `browser_fallback_url` if Chrome is absent.
 */

/**
 * Build the Chrome intent URL for a destination.
 *
 * Shape:
 *   intent://{host}{path}{query}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url={encoded};end
 */
export function buildAndroidIntentUrl(longUrl: string): string {
  const url = new URL(longUrl);

  const host = url.hostname; // hostname only — no scheme, no port
  const path = url.pathname === '/' ? '' : url.pathname; // drop a bare "/"
  const query = url.search; // includes leading "?" or ""
  const target = `${host}${path}${query}`;

  // Fallback is the full original URL, percent-encoded in its entirety.
  const fallback = encodeURIComponent(longUrl);

  return (
    `intent://${target}#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${fallback};end`
  );
}

// Escape a string for use inside an HTML attribute / text node.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safely embed a string as a JS string literal inside an inline <script>.
// JSON.stringify handles quotes/backslashes; the replacements stop a
// "</script>" or JS line-separator from breaking out of the script context.
function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Full-screen, dependency-free HTML page that immediately navigates to the
 * Chrome intent. `network` drives a CSS hook (`data-network`) for a per-app
 * pointer/arrow. Cache-Control: no-store is set by the route handler.
 */
export function buildAndroidEscapePage(longUrl: string, network: string): string {
  const intentUrl = buildAndroidIntentUrl(longUrl);
  const net = escapeHtml(network || 'generic');

  return `<!doctype html>
<html lang="en" data-network="${net}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Opening…</title>
  <style>
    html, body { margin: 0; height: 100%; background: #ffffff; }
    body {
      display: flex; align-items: center; justify-content: center;
      color: #1a1a1a; text-align: center; padding: 1.5rem;
      font-family: -apple-system, system-ui, Roboto, "Segoe UI", sans-serif;
    }
    .box { max-width: 22rem; }
    .mark { font-size: 2.75rem; line-height: 1; margin-bottom: 1rem; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    p { font-size: 1.05rem; line-height: 1.5; color: #555; margin: 0; }
  </style>
</head>
<body>
  <div class="box">
    <div class="mark">🚀</div>
    <h1>Opening in Chrome…</h1>
    <p>If nothing happens, tap &#x22EF; and select &#39;Open in browser&#39;</p>
  </div>
  <script>window.location.href = ${jsStringLiteral(intentUrl)};</script>
</body>
</html>`;
}
