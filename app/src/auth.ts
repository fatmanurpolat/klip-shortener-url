import jwt, { JwtPayload, SignOptions, Algorithm } from 'jsonwebtoken';
import { env } from './env';

/**
 * JWT helpers for passwordless (magic-link) auth.
 *
 * Two token types, both HS256 and signed with SESSION_SECRET:
 *   - magic-link: short-lived (15m), purpose "magic-link", proves email control.
 *   - session:    long-lived (30d), purpose "session", authenticates requests.
 *
 * The `purpose` claim is verified so the two token types can't be swapped
 * (a magic-link token can't be used as a session, and vice-versa).
 */

const ALG: Algorithm = 'HS256';
const MAGIC_LINK_TTL: SignOptions['expiresIn'] = '15m';
const SESSION_TTL: SignOptions['expiresIn'] = '30d';

export const SESSION_COOKIE = 'klipo_session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface SessionUser {
  userId: string;
  email: string;
}

/** Short-lived token emailed to the user (or returned in dev). */
export function signMagicLinkToken(user: SessionUser): string {
  return jwt.sign(
    { userId: user.userId, email: user.email, purpose: 'magic-link' },
    env.SESSION_SECRET,
    { algorithm: ALG, expiresIn: MAGIC_LINK_TTL },
  );
}

/** Verify a magic-link token; null if invalid, expired, or wrong purpose. */
export function verifyMagicLinkToken(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, env.SESSION_SECRET, { algorithms: [ALG] }) as JwtPayload;
    if (
      decoded.purpose !== 'magic-link' ||
      typeof decoded.userId !== 'string' ||
      typeof decoded.email !== 'string'
    ) {
      return null;
    }
    return { userId: decoded.userId, email: decoded.email };
  } catch {
    return null;
  }
}

/** Long-lived session token. Payload: { sub: userId, email, iat, exp }. */
export function signSessionToken(user: SessionUser): string {
  return jwt.sign(
    { email: user.email, purpose: 'session' },
    env.SESSION_SECRET,
    { algorithm: ALG, expiresIn: SESSION_TTL, subject: user.userId },
  );
}

/** Verify a session token; null if invalid, expired, or wrong purpose. */
export function verifySessionToken(token: string): SessionUser | null {
  try {
    const decoded = jwt.verify(token, env.SESSION_SECRET, { algorithms: [ALG] }) as JwtPayload;
    if (
      decoded.purpose !== 'session' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string'
    ) {
      return null;
    }
    return { userId: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}
