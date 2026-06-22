import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySessionToken, SESSION_COOKIE, SessionUser } from '../auth';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** Extract a session token from the Authorization header or the cookie. */
function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  const cookie = request.headers.cookie;
  if (cookie) {
    for (const part of cookie.split(';')) {
      const idx = part.indexOf('=');
      if (idx === -1) continue;
      const name = part.slice(0, idx).trim();
      if (name === SESSION_COOKIE) {
        return decodeURIComponent(part.slice(idx + 1).trim());
      }
    }
  }
  return null;
}

/**
 * Populate request.user from a valid session token, or null. Never blocks —
 * runs globally so every handler can read request.user (optional auth).
 */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  request.user = token ? verifySessionToken(token) : null;
}

/**
 * preHandler for protected routes: 401 if there's no authenticated user.
 * Relies on the global `authenticate` hook having run first.
 */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    return reply.code(401).send({ error: 'auth_required' });
  }
}

/** Register the global auth hook: decorate request.user and populate it. */
export function registerAuthHook(app: FastifyInstance): void {
  app.decorateRequest('user', null);
  app.addHook('onRequest', authenticate);
}
