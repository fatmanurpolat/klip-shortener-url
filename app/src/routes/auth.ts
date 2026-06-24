import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getPool } from '../db';
import { env } from '../env';
import { rateLimit } from '../security/rateLimit';
import { hashPassword, verifyPassword } from '../security/password';
import { requireAuth } from '../middleware/authenticate';
import { getEmailSender } from '../composition';
import { buildMagicLinkEmail } from '../email/magicLinkEmail';
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

// Session cookie attributes (shared by every path that signs a user in). Set via
// @fastify/cookie's reply.setCookie. `secure` is on only in production because a
// Secure cookie isn't sent over plain http (local dev). HttpOnly keeps it out of
// JS; SameSite=Lax blocks it on cross-site POSTs while allowing top-level nav.
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS, // 60 * 60 * 24 * 30 = 30 days, in seconds
};

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
  // The magic link lands the user on the DASHBOARD (APP_BASE_URL), which reads
  // ?token= on load, verifies it (sets the session cookie), strips it from the
  // URL, and shows the signed-in app. Without APP_BASE_URL set, fall back to the
  // API verify endpoint directly (dev without a frontend running).
  const apiBase = `${request.protocol}://${request.headers.host ?? env.SHORT_DOMAIN}`;
  const magicLink = env.APP_BASE_URL
    ? `${env.APP_BASE_URL}/?token=${encodeURIComponent(token)}`
    : `${apiBase}/api/v1/auth/verify?token=${encodeURIComponent(token)}`;

  // Always reply 200 ("Check your email") regardless of whether the email exists,
  // so this endpoint doesn't leak which addresses are registered.
  const sender = getEmailSender();
  if (sender) {
    try {
      await sender.send({ to: user.email, ...buildMagicLinkEmail(magicLink, env.MAGIC_LINK_TTL) });
    } catch (err) {
      // The SMTP send failed — surface a soft error so the UI can ask the user to
      // retry, but never echo the link or transport detail to the client.
      request.log.error({ err, userId: user.id }, 'magic-link email send failed');
      return reply
        .code(502)
        .send({ error: 'email_send_failed', message: 'We could not send the login email. Please try again shortly.' });
    }
    return reply.code(200).send({ message: 'Check your email' });
  }

  // No SMTP provider configured (SMTP_HOST + EMAIL_FROM unset).
  if (isProd) {
    request.log.warn(
      { userId: user.id },
      'magic-link issued but NO email provider configured — set SMTP_HOST + EMAIL_FROM to actually deliver login emails',
    );
  } else {
    // Dev fallback: log the link server-side (`docker compose logs app`) so you
    // can still sign in without an email provider. The token is NEVER returned in
    // the HTTP response — doing so would be an email-less sign-in bypass (anyone
    // could sign in as any address without controlling its inbox).
    request.log.info({ userId: user.id, magicLink }, 'magic-link (dev, no email provider) — open this URL to sign in');
  }
  return reply.code(200).send({ message: 'Check your email' });
}

async function handleVerify(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Called by the dashboard SPA (lib/api.ts verifyToken) once it reads ?token=
  // from its own URL: verifies the magic-link token, sets the session cookie, and
  // returns JSON. The browser-facing magic link points at the dashboard, not here.
  const parsed = verifySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ error: 'validation_error', message: 'token is required.' });
  }

  const user = verifyMagicLinkToken(parsed.data.token);
  if (!user) {
    return reply.code(401).send({ error: 'invalid_token', message: 'This login link is invalid or has expired.' });
  }

  const token = signSessionToken(user);
  reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  // Return the email too so the dashboard can show it without a round-trip.
  return reply.code(200).send({ token, userId: user.userId, email: user.email });
}

/**
 * Current signed-in user from the session cookie — the dashboard calls this on
 * load to show the account email (the magic-link flow doesn't otherwise expose
 * it). `request.user` is populated by the global authenticate hook; requireAuth
 * returns 401 when there's no valid session.
 */
async function handleMe(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  const user = request.user!; // requireAuth guarantees this is set
  return reply.code(200).send({ userId: user.userId, email: user.email });
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
  reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
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
  reply.setCookie(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
  return reply.code(200).send({ userId: user.userId, email: user.email });
}

async function handleLogout(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Clear the cookie by setting an empty value with Max-Age 0.
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  return reply.code(200).send({ ok: true });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  // Per-IP limits: request-login 5/min (stricter — it triggers an email),
  // verify 10/min. Both share the klipo:rl:auth:{ip} key (combined auth budget).
  app.post('/api/v1/auth/request-login', { preHandler: rateLimit('auth', 5) }, handleRequestLogin);
  app.get('/api/v1/auth/verify', { preHandler: rateLimit('auth-verify', 10) }, handleVerify);
  // Current-user probe (dashboard reads this on load for the account email).
  app.get('/api/v1/auth/me', { preHandler: requireAuth }, handleMe);
  // Email + password paths. register 5/min (account creation), login 10/min —
  // both throttled per-IP to blunt credential-stuffing and signup abuse.
  app.post('/api/v1/auth/register', { preHandler: rateLimit('auth-register', 5) }, handleRegister);
  app.post('/api/v1/auth/login', { preHandler: rateLimit('auth-login', 10) }, handleLogin);
  app.post('/api/v1/auth/logout', handleLogout);
}
