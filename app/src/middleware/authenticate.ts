import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifySessionToken, SESSION_COOKIE, SessionUser } from '../auth';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/**
 * Extract a session token from the Authorization header or the session cookie.
 * Cookies are parsed by @fastify/cookie (registered before this hook), so we
 * read the already-parsed request.cookies rather than the raw header.
 */
function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  const cookieToken = request.cookies?.[SESSION_COOKIE];
  return cookieToken ? cookieToken : null;
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
