import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SHORT_BASE_URL } from '../env';
import { urlSafetyResponse } from '../security/urlSafety';
import { rateLimit, getClientIp } from '../security/rateLimit';
import { ipPrefix } from '../security/ipPrefix';
import { shortenTotal } from '../metrics';
import { getShortenLinkUseCase } from '../composition';
import type { ShortenError } from '../application/shorten/ShortenLinkUseCase';

/**
 * POST /api/v1/shorten — HTTP adapter (hexagonal).
 *
 * Thin: validate the body (Zod) and build the input, delegate the whole write
 * path to ShortenLinkUseCase (which owns the policy + orchestration), then map
 * its typed Result back to the exact HTTP responses this endpoint promises.
 * All persistence/cache/audit/id/url-safety logic lives behind ports.
 */

const ALIAS_RE = /^[0-9A-Za-z_-]{3,32}$/;

const bodySchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//i.test(u), 'only http/https allowed')
    // Reject raw control chars (CR/LF/Tab/NUL/DEL): valid URLs percent-encode
    // them; storing them un-normalized invites header/log issues downstream.
    .refine((u) => !/[\x00-\x1f\x7f]/.test(u), 'control characters are not allowed'),
  customAlias: z.string().regex(ALIAS_RE).optional(),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .refine((v) => !v || new Date(v) > new Date(), 'must be in the future'),
  private: z.boolean().default(false),
  analytics: z.boolean().default(true), // false → prefer_301 = true in DB
});

/** Owner of the link, or null for anonymous requests (set by the auth hook). */
function getOwnerId(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}

/** Map a Zod failure to the specific error contract this endpoint promises. */
function sendValidationError(error: z.ZodError, reply: FastifyReply): FastifyReply {
  const issues = error.issues;

  const urlIssue = issues.find((i) => i.path[0] === 'url');
  if (urlIssue) {
    return reply.code(400).send({ error: 'invalid_url', message: urlIssue.message });
  }

  // The .refine on expiresAt produces a `custom` issue → expiry in the past.
  const pastExpiry = issues.find((i) => i.path[0] === 'expiresAt' && i.code === 'custom');
  if (pastExpiry) {
    return reply.code(422).send({ error: 'invalid_expiry', message: pastExpiry.message });
  }

  const first = issues[0];
  return reply.code(400).send({
    error: 'validation_error',
    message: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body',
  });
}

/** Map a use-case ShortenError to the exact HTTP status/body (unchanged contract). */
function sendShortenError(error: ShortenError, reply: FastifyReply): FastifyReply {
  switch (error.kind) {
    case 'auth_required':
      return reply.code(401).send({ error: 'auth_required', message: 'Sign in to create a private link.' });
    case 'reserved_alias':
      return reply.code(400).send({ error: 'reserved_alias', message: 'This alias is reserved and cannot be used.' });
    case 'unsafe_url': {
      const { status, body } = urlSafetyResponse(error.error);
      return reply.code(status).send(body);
    }
    case 'quota_exceeded':
      return reply.code(429).send({ error: 'quota_exceeded', message: 'Link quota reached.' });
    case 'quota_unavailable':
      return reply.code(503).send({ error: 'quota_check_unavailable', message: 'Please retry in a moment.' });
    case 'counter_unavailable':
      return reply.code(503).send({ error: 'counter_unavailable', message: 'Could not allocate an ID, please retry.' });
    case 'alias_taken':
      return reply.code(409).send({ error: 'alias_taken', message: 'This alias is already in use.' });
    case 'persist_failed':
      return reply.code(500).send({ error: 'internal_error', message: 'Could not create the short link.' });
  }
}

async function handleShorten(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  // Rate limiting runs in the rateLimit('shorten', …) preHandler (see route reg).

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return sendValidationError(parsed.error, reply);
  }
  const body = parsed.data;

  const execute = getShortenLinkUseCase(request.log);
  let result;
  try {
    result = await execute({
      url: body.url,
      customAlias: body.customAlias,
      expiresAt: body.expiresAt ?? null,
      private: body.private,
      analytics: body.analytics,
      ownerId: getOwnerId(request),
      ipPrefix: ipPrefix(getClientIp(request)),
      log: request.log,
    });
  } catch (err) {
    // The use-case only rethrows an UNEXPECTED (non-UrlSafetyError) validator
    // failure → fail closed, exactly as before.
    request.log.error({ err }, 'shorten: url safety check errored');
    return reply.code(500).send({ error: 'internal_error', message: 'Could not validate the URL.' });
  }

  if (!result.ok) {
    return sendShortenError(result.error, reply);
  }

  const { value } = result;
  shortenTotal.inc({ type: body.customAlias ? 'custom_alias' : 'generated' });
  return reply.code(201).send({
    shortUrl: `${SHORT_BASE_URL}/${value.shortCode}`,
    code: value.shortCode,
    longUrl: value.longUrl,
    createdAt: value.createdAt.toISOString(),
    expiresAt: value.expiresAt,
    private: value.private,
    analytics: value.analytics,
  });
}

export async function registerShortenRoutes(app: FastifyInstance): Promise<void> {
  // Rate limit: anonymous 10/min by IP, authenticated 120/min by user. The global
  // `authenticate` onRequest hook has already populated request.user.
  app.post('/api/v1/shorten', { preHandler: rateLimit('shorten', 10, 120) }, handleShorten);
}
