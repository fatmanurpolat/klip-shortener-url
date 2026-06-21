import { FastifyReply } from 'fastify';

/**
 * In-app browser (webview) detection + escape handoff.
 *
 * Detection is final; the escape behaviour is a STUB. P1-3/P1-4 will replace
 * {@link escapeWebview} with the real interstitial that breaks links out of
 * Instagram/TikTok/etc. webviews. For now it performs a plain 302.
 */

const WEBVIEW_PATTERNS = [
  /Instagram/,
  /FBAN/,
  /FBAV/,
  /FB_IAB/,
  /TikTok/,
  /musical_ly/,
  /BytedanceWebview/,
  / Line\//,
  /Snapchat/,
  /; wv/,
];

export function isWebview(ua: string): boolean {
  return ua.length > 0 && WEBVIEW_PATTERNS.some((p) => p.test(ua));
}

/**
 * STUB: hand off a webview visit. Today it just 302-redirects to the target.
 * Replaced in P1 with the webview-escape interstitial.
 */
export function escapeWebview(reply: FastifyReply, longUrl: string): FastifyReply {
  reply.header('Cache-Control', 'no-store');
  return reply.redirect(longUrl, 302);
}
