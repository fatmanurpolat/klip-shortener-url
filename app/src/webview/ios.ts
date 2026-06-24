/**
 * iOS webview escape.
 *
 * iOS has no Android-style intent URL. We first try the `x-safari-https://`
 * scheme to kick the user into Safari; if that doesn't navigate within ~1.2s we
 * reveal per-network manual instructions ("tap ⋯ → Open in browser") plus a
 * Copy-link button. Fully self-contained: no external scripts/styles/pixels.
 */

const INSTRUCTIONS: Record<string, string> = {
  instagram: "Tap ⋯ in the top right, then tap 'Open in external browser'",
  facebook: "Tap ⋯ in the top right, then tap 'Open in browser'",
  tiktok: "Tap ⋯ in the top right, then tap 'Open in browser'",
  line: "Tap ⋯ in the top right, then tap 'Open in external browser'",
  snapchat: "Tap ⋯ in the top right, then tap 'Open in browser'",
  generic: "Tap your browser's menu, then tap 'Open in browser'",
};

// Networks that get the top-right arrow pointing at the ⋯ menu.
const ARROW_NETWORKS = new Set(['instagram', 'facebook', 'tiktok', 'line', 'snapchat']);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Safe JS string literal for inline <script>: JSON handles quotes/backslashes;
// escaping "<" prevents a "</script>" (or "<!--") in the URL from breaking out,
// and U+2028/U+2029 (line/paragraph separators) are escaped to match android.ts
// (they are valid in JSON strings but were string-literal terminators pre-ES2019).
function jsStringLiteral(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function buildIosEscapePage(longUrl: string, network: string): string {
  const key = INSTRUCTIONS[network] ? network : 'generic';
  const instruction = escapeHtml(INSTRUCTIONS[key]);
  const showArrow = ARROW_NETWORKS.has(key);
  const urlLiteral = jsStringLiteral(longUrl);

  return `<!doctype html>
<html lang="en" data-network="${escapeHtml(key)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Opening…</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; height: 100%; background: #ffffff; }
    body {
      font-family: -apple-system, system-ui, Roboto, "Segoe UI", sans-serif;
      color: #1a1a1a; font-size: 16px;
      display: flex; align-items: center; justify-content: center;
      text-align: center; padding: 1.5rem; min-height: 100%;
    }
    .panel { width: 100%; max-width: 24rem; }

    /* Default state: attempting the escape. */
    .loading .label { font-size: 1.125rem; color: #333333; margin: 0; }
    .spinner {
      width: 36px; height: 36px; margin: 0 auto 1rem;
      border: 3px solid #e6e6e6; border-top-color: #c2185b; border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }

    /* Manual instructions: hidden until the escape is deemed failed. */
    .instructions { display: none; }
    body.escape-failed .loading { display: none; }
    body.escape-failed .instructions { display: block; }

    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    .instruction-text { font-size: 1.0625rem; line-height: 1.5; color: #333333; margin: 0 0 1.25rem; }

    /* Top-right arrow pointing at the ⋯ menu (named networks only). */
    .arrow {
      position: fixed; top: 10px; right: 18px;
      width: 0; height: 0;
      border-left: 12px solid transparent;
      border-right: 12px solid transparent;
      border-bottom: 18px solid #c2185b;
      animation: arrow-bounce 1s ease-in-out infinite;
    }
    html[data-network="generic"] .arrow { display: none; }

    #copy {
      font: inherit; font-size: 1rem; font-weight: 600;
      min-height: 44px; padding: 0.75rem 1.5rem;
      border: none; border-radius: 12px;
      color: #ffffff; background: #c2185b; cursor: pointer;
    }
    #copy:active { opacity: 0.85; }
    .toast {
      display: block; height: 1.25rem; margin-top: 0.75rem;
      font-size: 1rem; font-weight: 600; color: #1a7f37;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes arrow-bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

    /* Respect reduced-motion: kill the spinner + bouncing arrow. */
    @media (prefers-reduced-motion: reduce) {
      .spinner { animation: none; }
      .arrow { animation: none; }
    }
  </style>
</head>
<body>
  <div class="panel">
    <div class="loading">
      <div class="spinner" aria-hidden="true"></div>
      <p class="label">Opening in browser…</p>
    </div>

    <div class="instructions">
      ${showArrow ? '<div class="arrow" aria-hidden="true"></div>' : ''}
      <h1>Almost there</h1>
      <p class="instruction-text">${instruction}</p>
      <button type="button" id="copy" aria-label="Copy link to clipboard">Copy link</button>
      <span class="toast" id="toast" role="status" aria-live="polite"></span>
    </div>
  </div>

  <script>
    (function () {
      var LONG_URL = ${urlLiteral};

      // 1) Try to bounce into Safari.
      try {
        window.location.href = "x-safari-https://" + LONG_URL.replace(/^https?:\\/\\//, "");
      } catch (e) {}

      // 2) If we're still here after 1.2s, reveal manual instructions.
      setTimeout(function () {
        document.body.classList.add("escape-failed");
      }, 1200);

      // 3) Copy-link button.
      var btn = document.getElementById("copy");
      var toast = document.getElementById("toast");
      if (btn) {
        btn.addEventListener("click", function () {
          navigator.clipboard.writeText(LONG_URL).then(function () {
            btn.textContent = "Copied!";
            if (toast) toast.textContent = "Copied!";
            setTimeout(function () {
              btn.textContent = "Copy link";
              if (toast) toast.textContent = "";
            }, 2000);
          }).catch(function () {
            if (toast) toast.textContent = "Press and hold the link to copy";
          });
        });
      }
    })();
  </script>
</body>
</html>`;
}
