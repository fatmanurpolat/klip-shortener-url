import 'dotenv/config';
import { z } from 'zod';

// Treat an empty env value ("") as "unset" for optional secrets/toggles, so a
// blank line in .env (e.g. `SMTP_HOST=`) disables the feature instead of failing
// the min-length check and crash-looping the app on boot.
const optionalNonEmpty = (min: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.string().min(min).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  PORT: z.coerce.number().int().positive().default(3000),
  // Pino log level. In development the logger also pretty-prints (pino-pretty);
  // production emits raw JSON for log shippers.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().url(),
  // Postgres pool size PER APP INSTANCE. Horizontal scaling multiplies this:
  // total server connections ≈ (replica count) × PG_POOL_MAX, so keep
  // replicas × PG_POOL_MAX + headroom under Postgres max_connections (default
  // 100). e.g. 3 replicas × 10 = 30 (fine); raise max_connections before ~9.
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().url(),
  // Redis Sentinel HA. When set, a comma-separated "host:port" list of Sentinel
  // nodes — the client then connects VIA Sentinel and follows master failover,
  // ignoring REDIS_URL. Leave UNSET for a single-node Redis (local dev / tests),
  // where REDIS_URL is used directly.
  //   e.g. REDIS_SENTINELS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
  REDIS_SENTINELS: z.string().optional(),
  // The monitored master's name; MUST match `sentinel monitor <name>` in
  // redis/sentinel.conf. Only used when REDIS_SENTINELS is set.
  REDIS_MASTER_NAME: z.string().min(1).default('klip-master'),
  REDIS_URL_TTL: z.coerce.number().int().nonnegative().default(86400),

  COUNTER_BACKEND: z.enum(['redis', 'postgres', 'snowflake']).default('redis'),
  // Snowflake node id (only used when COUNTER_BACKEND=snowflake). MUST be UNIQUE
  // per app replica (0-1023) — it's stamped into every id for cross-node
  // uniqueness, so two replicas sharing a MACHINE_ID will mint duplicate ids.
  MACHINE_ID: z.coerce.number().int().min(0).max(1023).default(0),
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

  // Magic-link email delivery over SMTP (Mailpit in dev; any SMTP relay/provider
  // in prod). When SMTP_HOST + EMAIL_FROM are set, login emails are actually sent;
  // otherwise the request degrades (dev returns the link in the response; prod
  // logs a warning). SMTP_USER/SMTP_PASS are optional (Mailpit needs neither);
  // SMTP_SECURE=true uses implicit TLS (port 465). EMAIL_FROM is the From address,
  // e.g. "Klipo <login@klipo.to>".
  SMTP_HOST: optionalNonEmpty(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: optionalNonEmpty(1),
  SMTP_PASS: optionalNonEmpty(1),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  EMAIL_FROM: optionalNonEmpty(3),

  // Dashboard URL the emailed magic link points at: `${APP_BASE_URL}/?token=...`.
  // The dashboard reads ?token= on load, verifies it (sets the session cookie),
  // strips it, and shows the signed-in app. Dev: http://localhost:4100 (the Vite
  // dashboard). Prod: e.g. https://app.klipo.to. When unset, the magic link falls
  // back to the API verify endpoint directly. Trusted config, not user input.
  APP_BASE_URL: optionalNonEmpty(1),

  // How long an emailed magic-link stays valid (jsonwebtoken/`ms` format: "15m",
  // "1h", "24h", "7d"). Shorter = safer if a link leaks; default 15m. The email
  // copy reflects this value. (Independent of the 30d session that login creates.)
  MAGIC_LINK_TTL: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).default('15m')),

  // Trust X-Forwarded-For (client IP behind a proxy). Set to "true" ONLY when
  // Klipo runs behind a trusted reverse proxy (e.g. nginx) that sets XFF —
  // otherwise clients could spoof their IP and dodge per-IP rate limits. Governs
  // both Fastify's req.ip and the rate limiter's getClientIp.
  TRUST_PROXY: z
    .string()
    .optional()
    .transform((v) => v === 'true'),

  // CORS allowlist (comma-separated origins). When SET, only these origins are
  // allowed (with credentials). When UNSET, the API reflects the request origin —
  // convenient for local dev, but you SHOULD set an explicit allowlist in
  // production so a hostile site can't make credentialed cross-origin calls.
  CORS_ALLOWED_ORIGINS: z.string().optional(),

  // Secret for signing magic-link and session JWTs. Required (app refuses to
  // start without it). Use a long, random string in every environment.
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Shared secret for the internal /admin endpoints (sent as the X-Admin-Secret
  // header). When UNSET, the admin API is disabled (every call returns 503).
  ADMIN_SECRET: z.string().min(16).optional(),

  // Active-link caps (not disabled, not expired). USER_LINK_QUOTA limits each
  // signed-in user; ANON_LINK_QUOTA limits anonymous shorteners per IP prefix.
  // Over the cap → 429. Deleting/expiring links frees room.
  USER_LINK_QUOTA: z.coerce.number().int().positive().default(1000),
  ANON_LINK_QUOTA: z.coerce.number().int().positive().default(100),

  RAW_CLICK_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(90),
  LINK_RETENTION_MONTHS: z.coerce.number().int().nonnegative().default(120),
}).superRefine((cfg, ctx) => {
  // PRODUCTION HARDENING: refuse to boot with placeholder/default signing secrets
  // or a CHANGE_ME database password. They pass the length checks above but would
  // ship a remotely-forgeable session/admin secret + a publicly-known DB password
  // (the two CRITICALs from the security audit). Dev/test are exempt so local
  // workflows keep using stub values.
  if (cfg.NODE_ENV !== 'production') return;
  const flag = (
    field: 'SESSION_SECRET' | 'HASHIDS_SALT' | 'ADMIN_SECRET' | 'DATABASE_URL',
    value: string | undefined,
  ): void => {
    if (looksLikePlaceholderSecret(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} looks like a placeholder/default — set a real, secret value before running in production`,
      });
    }
  };
  flag('SESSION_SECRET', cfg.SESSION_SECRET);
  flag('HASHIDS_SALT', cfg.HASHIDS_SALT);
  flag('ADMIN_SECRET', cfg.ADMIN_SECRET);
  flag('DATABASE_URL', cfg.DATABASE_URL);
});

/** True if a secret/URL still carries a well-known placeholder/default token. */
export function looksLikePlaceholderSecret(value: string | undefined): boolean {
  // `your[_-]` is intentionally UNanchored so an embedded placeholder (e.g. a
  // DATABASE_URL password `…:your_pass@…`) is also caught, not just values that
  // start with it.
  return !!value && /change[_-]?me|placeholder|your[_-]|dev[_-]?klip|test[_-]?(secret|salt)/i.test(value);
}

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
