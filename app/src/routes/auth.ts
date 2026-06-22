import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
import { env } from '../env';
import { rateLimit } from '../security/rateLimit';
import {
  signMagicLinkToken,
  verifyMagicLinkToken,
  signSessionToken,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from '../auth';

const requestLoginSchema = z.object({
  email: z.string().email().max(320),
});

const verifySchema = z.object({
  token: z.string().min(1),
});

const isProd = env.NODE_ENV === 'production';

/** Build the Set-Cookie value for the session cookie (or a cleared one). */
function sessionCookie(value: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  // Secure cookies aren't sent over plain http, so only set it in production.
  if (isProd) parts.push('Secure');
  return parts.join('; ');
}

/** Find an existing user by email or create one. Atomic upsert (email is unique). */
async function findOrCreateUser(email: string): Promise<{ id: string; email: string }> {
  const res = await getPool().query<{ id: string; email: string }>(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email`,
    [email],
  );
  return res.rows[0];
}

async function handleRequestLogin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Rate limiting runs in the rateLimit('auth', 5) preHandler (see route reg).
  const parsed = requestLoginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'A valid email is required.' });
  }

  const user = await findOrCreateUser(parsed.data.email);
  const token = signMagicLinkToken({ userId: user.id, email: user.email });

  if (isProd) {
    // TODO(P1): send the email. For now, just record that we would.
    request.log.info({ userId: user.id }, 'magic-link issued (email delivery stub)');
    return reply.code(200).send({ message: 'Check your email' });
  }

  // Development: hand back the token (and a directly-usable verify link) for testing.
  const base = `${request.protocol}://${request.headers.host ?? env.SHORT_DOMAIN}`;
  return reply.code(200).send({
    message: 'Check your email',
    token,
    magicLink: `${base}/api/v1/auth/verify?token=${encodeURIComponent(token)}`,
  });
}

async function handleVerify(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = verifySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'token is required.' });
  }

  const user = verifyMagicLinkToken(parsed.data.token);
  if (!user) {
    return reply.code(401).send({ error: 'invalid_token', message: 'This login link is invalid or has expired.' });
  }

  const token = signSessionToken(user);
  reply.header('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS));
  return reply.code(200).send({ token, userId: user.userId });
}

async function handleLogout(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Clear the cookie by setting an empty value with Max-Age 0.
  reply.header('Set-Cookie', sessionCookie('', 0));
  return reply.code(200).send({ ok: true });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Per-IP limits: request-login 5/min (stricter — it triggers an email),
  // verify 10/min. Both share the klip:rl:auth:{ip} key (combined auth budget).
  app.post('/api/v1/auth/request-login', { preHandler: rateLimit('auth', 5) }, handleRequestLogin);
  app.get('/api/v1/auth/verify', { preHandler: rateLimit('auth-verify', 10) }, handleVerify);
  app.post('/api/v1/auth/logout', handleLogout);
}
