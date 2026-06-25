/**
 * Script-driven ("soft") redirect page for mobile browsers.
 *
 * A server 301/302 to instagram.com / tiktok.com is captured by iOS Universal
 * Links (and Android App Links) and handed to the native app — even for the
 * /embed path on recent OS versions. A navigation initiated by JavaScript
 * WITHOUT a user gesture (`location.replace`) is instead treated like an
 * address-bar load, which the OS does NOT hand off to the app. So on mobile we
 * return this tiny HTML page and let the script carry the user to the
 * destination, keeping them in the browser.
 *
 * Fully self-contained: no external scripts/styles. The <noscript> / visible
 * fallback link covers the (rare) no-JS case; tapping it is a user gesture and
 * may open the app, which is the acceptable last resort.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe JS string literal for the inline <script>: JSON handles quotes/backslashes;
// escaping "<" prevents a "</script>" in the URL from breaking out, and
// U+2028/U+2029 are escaped (valid in JSON, but string-literal terminators pre-ES2019).
function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
}

export function buildSoftRedirectPage(destUrl: string): string {
  const urlLiteral = jsStringLiteral(destUrl);
  const urlAttr = escapeHtml(destUrl);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Opening…</title>
  <style>
    html, body { margin: 0; height: 100%; background: #ffffff; }
    body {
      font-family: -apple-system, system-ui, Roboto, "Segoe UI", sans-serif;
      color: #5b4a6b; display: flex; align-items: center; justify-content: center;
      text-align: center; padding: 1.5rem; min-height: 100%;
    }
    .spinner {
      width: 36px; height: 36px; margin: 0 auto 1rem;
      border: 3px solid #e6e6e6; border-top-color: #c2185b; border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    a { color: #c2185b; font-weight: 600; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  </style>
</head>
<body>
  <div>
    <div class="spinner" aria-hidden="true"></div>
    <p>Opening in browser… <a href="${urlAttr}">tap here</a> if nothing happens.</p>
    <noscript><a href="${urlAttr}">Continue</a></noscript>
  </div>
  <script>
    // Gesture-less JS navigation: the OS treats this like an address-bar load
    // and does NOT hand it to the Universal-Link / App-Link app.
    (function () {
      try { window.location.replace(${urlLiteral}); }
      catch (e) { window.location.href = ${urlLiteral}; }
    })();
  </script>
</body>
</html>`;
}
