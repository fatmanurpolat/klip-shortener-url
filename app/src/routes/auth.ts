import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
import { env } from '../env';
import { rateLimit } from '../security/rateLimit';
import { hashPassword, verifyPassword } from '../security/password';
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

// Email + password credentials. Min length is the only strength rule enforced
// server-side; the 200-char cap bounds scrypt input so a huge body can't be
// used to burn CPU.
const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
});

const isProd = env.NODE_ENV === 'production';

// A throwaway hash verified on the "no such user" login path so that response
// time doesn't reveal whether an email exists (anti-enumeration). Computed once.
const dummyHashPromise = hashPassword(randomBytes(18).toString('hex'));

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

async function handleRegister(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({
      error: 'validation_error',
      message: parsed.error.issues[0]?.message ?? 'A valid email and a password of 8+ characters are required.',
    });
  }
  const { email, password } = parsed.data;

  // Hash before touching the DB; only the hash is ever stored.
  const passwordHash = await hashPassword(password);

  // Create ONLY brand-new emails. If the email already exists (whether it has a
  // password or is magic-link-only), refuse — silently setting a password on an
  // existing account would let someone hijack a magic-link user's account.
  const res = await getPool().query<{ id: string; email: string }>(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email`,
    [email, passwordHash],
  );
  if (res.rows.length === 0) {
    return reply
      .code(409)
      .send({ error: 'email_taken', message: 'An account with this email already exists. Try signing in instead.' });
  }

  const user = { userId: res.rows[0].id, email: res.rows[0].email };
  const token = signSessionToken(user);
  reply.header('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS));
  return reply.code(201).send({ userId: user.userId, email: user.email });
}

async function handleLogin(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const parsed = credentialsSchema.safeParse(request.body);
  if (!parsed.success) {
    // Don't echo which field failed — keep the login surface quiet.
    return reply.code(400).send({ error: 'validation_error', message: 'Email and password are required.' });
  }
  const { email, password } = parsed.data;

  const res = await getPool().query<{ id: string; email: string; password_hash: string | null }>(
    `SELECT id, email, password_hash FROM users WHERE email = $1`,
    [email],
  );
  const row = res.rows[0];

  // Always run a verify (against a dummy hash when the user/password is absent)
  // so timing doesn't reveal whether the email exists or has a password.
  const hashToCheck = row?.password_hash ?? (await dummyHashPromise);
  const passwordOk = await verifyPassword(password, hashToCheck);

  if (!row || !row.password_hash || !passwordOk) {
    return reply.code(401).send({ error: 'invalid_credentials', message: 'Incorrect email or password.' });
  }

  const user = { userId: row.id, email: row.email };
  const token = signSessionToken(user);
  reply.header('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE_SECONDS));
  return reply.code(200).send({ userId: user.userId, email: user.email });
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
  // Email + password paths. register 5/min (account creation), login 10/min —
  // both throttled per-IP to blunt credential-stuffing and signup abuse.
  app.post('/api/v1/auth/register', { preHandler: rateLimit('auth-register', 5) }, handleRegister);
  app.post('/api/v1/auth/login', { preHandler: rateLimit('auth-login', 10) }, handleLogin);
  app.post('/api/v1/auth/logout', handleLogout);
}
