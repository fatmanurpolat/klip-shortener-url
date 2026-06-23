import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Pino log level. In development the logger also pretty-prints (pino-pretty);
  // production emits raw JSON for log shippers.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_URL_TTL: z.coerce.number().int().nonnegative().default(86400),

  COUNTER_BACKEND: z.enum(['redis', 'postgres']).default('redis'),
  // Counter start value. 0 keeps short codes minimal — Hashids minLength (4) is
  // what guarantees the 4-char floor, NOT the offset. (A large offset pre-inflates
  // the encoded integer and produces longer codes.)
  COUNTER_OFFSET: z.coerce.number().int().nonnegative().default(0),
  HASHIDS_SALT: z.string().min(20, 'HASHIDS_SALT must be at least 20 characters'),
  SHORT_DOMAIN: z.string().min(1).default('klipo.to'),
  // Scheme used when building short URLs. https in production; set to http for
  // local dev (e.g. SHORT_DOMAIN=localhost:3000) so the links are clickable.
  SHORT_SCHEME: z.enum(['http', 'https']).default('https'),

  // Optional: Google Safe Browsing v4 API key. When set, destination URLs are
  // checked against Safe Browsing at shorten time (cached, fail-open). Unset =
  // the check is skipped entirely.
  SAFE_BROWSING_API_KEY: z.string().min(1).optional(),

  // Trust X-Forwarded-For (client IP behind a proxy). Set to "true" ONLY when
  // Klipo runs behind a trusted reverse proxy (e.g. nginx) that sets XFF —
  // otherwise clients could spoof their IP and dodge per-IP rate limits. Governs
  // both Fastify's req.ip and the rate limiter's getClientIp.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Secret for signing magic-link and session JWTs. Required (app refuses to
  // start without it). Use a long, random string in every environment.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Shared secret for the internal /admin endpoints (sent as the X-Admin-Secret
  // header). When UNSET, the admin API is disabled (every call returns 503).
  ADMIN_SECRET: z.string().min(16).optional(),

  RAW_CLICK_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),
  LINK_RETENTION_MONTHS: z.coerce.number().int().nonnegative().default(120),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast with a readable message instead of a deep stack trace.
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;

/**
 * Base URL for short links (no trailing slash). Built from SHORT_SCHEME +
 * SHORT_DOMAIN so dev (http://localhost:3000) and production (https://klipo.to)
 * both produce clickable links. Use as `${SHORT_BASE_URL}/${code}`.
 */
export const SHORT_BASE_URL = `${env.SHORT_SCHEME}://${env.SHORT_DOMAIN}`;
