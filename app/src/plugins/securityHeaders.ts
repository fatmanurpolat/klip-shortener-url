import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Inject hardened HTTP security headers on every non-redirect response.
 *
 * Applied via an `onSend` hook so it covers API JSON, the webview-escape
 * interstitial, and the 404 page alike. Plain 3xx redirects (the /:code hot
 * path) are SKIPPED — a redirect has no document body to protect, and keeping
 * the redirect response lean avoids touching the product's core function.
 *
 * X-Frame-Options: DENY + CSP `frame-ancestors 'none'` are the load-bearing
 * pair: the interstitial (and every HTML page we serve) must never be
 * embeddable, so a hostile page can't frame it and trick a visitor.
 *
 * HSTS is intentionally NOT set here — TLS terminates at nginx, which owns the
 * Strict-Transport-Security header (see nginx/conf.d/klip.conf). Setting it on
 * the app too would just duplicate it behind the proxy.
 */

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Modern browsers rely on CSP; the legacy XSS auditor is disabled (1 can
  // introduce its own vulnerabilities), per OWASP guidance.
  'X-XSS-Protection': '0',
  'Content-Security-Policy':
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

/** True for redirect status codes that carry a Location instead of a body. */
function isRedirect(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function securityHeadersPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    if (isRedirect(reply.statusCode)) {
      return payload; // skip plain redirects (e.g. /:code 301/302)
    }
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      // Don't clobber a header a route deliberately set (e.g. a future per-route CSP).
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    return payload;
  });
}

// fastify-plugin so the onSend hook is registered on the ROOT instance (not an
// encapsulated child), making it apply to every route in the app.
export const securityHeaders = fp(securityHeadersPlugin, {
  name: 'klip-security-headers',
  fastify: '5.x',
});
