import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REDIS_URL_TTL: z.coerce.number().int().nonnegative().default(86400),

  COUNTER_BACKEND: z.enum(['redis', 'postgres']).default('redis'),
  COUNTER_OFFSET: z.coerce.number().int().nonnegative().default(14776336),
  HASHIDS_SALT: z.string().min(1, 'HASHIDS_SALT must be set'),
  SHORT_DOMAIN: z.string().min(1).default('klip.to'),

  // Optional: Google Safe Browsing v4 API key. When set, destination URLs are
  // checked against Safe Browsing at shorten time (cached, fail-open). Unset =
  // the check is skipped entirely.
  SAFE_BROWSING_API_KEY: z.string().min(1).optional(),

  // Trust X-Forwarded-For (client IP behind a proxy). Set to "true" ONLY when
  // Klip runs behind a trusted reverse proxy (e.g. nginx) that sets XFF —
  // otherwise clients could spoof their IP and dodge per-IP rate limits. Governs
  // both Fastify's req.ip and the rate limiter's getClientIp.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // Secret for signing magic-link and session JWTs. Required (app refuses to
  // start without it). Use a long, random string in every environment.
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be set (>= 16 chars)'),

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
