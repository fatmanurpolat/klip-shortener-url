// Pure builder for the magic-link login email (subject + HTML + text). No infra
// deps so it's trivially unit-testable. The link is HTML-escaped before being
// placed in the href/anchor so a token can never break out of the attribute.

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface MagicLinkEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * Turn a jsonwebtoken/`ms` TTL string ("15m", "24h", "7d") into human words
 * ("15 minutes", "24 hours", "7 days") for the email copy. Falls back to the raw
 * value for anything it doesn't recognise.
 */
export function humanizeTtl(ttl: string): string {
  const m = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(
    ttl.trim(),
  );
  if (!m) return ttl;
  const n = parseInt(m[1], 10);
  const u = m[2].toLowerCase();
  const word = u.startsWith('s') ? 'second' : u.startsWith('h') ? 'hour' : u.startsWith('d') ? 'day' : 'minute';
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function buildMagicLinkEmail(magicLink: string, ttl = '15m'): MagicLinkEmailContent {
  const safe = escapeHtml(magicLink);
  const expiresLabel = humanizeTtl(ttl);
  const subject = 'Your Klipo sign-in link';
  const text = [
    'Sign in to Klipo',
    '',
    `Click the link below to sign in. It expires in ${expiresLabel} and can only be used once:`,
    '',
    magicLink,
    '',
    "If you didn't request this, you can safely ignore this email.",
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#faf5ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(124,58,237,0.08);">
      <tr>
        <td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:#7c3aed;">Sign in to Klipo</h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#4b5563;">
            Tap the button below to sign in. This link expires in ${expiresLabel} and can only be used once.
          </p>
          <a href="${safe}" style="display:inline-block;padding:12px 24px;background:linear-gradient(135deg,#ec4899,#7c3aed);color:#ffffff;text-decoration:none;border-radius:10px;font-weight:600;font-size:15px;">
            Sign in
          </a>
          <p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#6b7280;">
            Or paste this URL into your browser:<br />
            <a href="${safe}" style="color:#7c3aed;word-break:break-all;">${safe}</a>
          </p>
          <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
            If you didn't request this, you can safely ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
