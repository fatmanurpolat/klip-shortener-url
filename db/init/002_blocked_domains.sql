-- =============================================================================
-- Klip — blocked_domains
-- Destinations that may never be shortened. Consulted at shorten time (write
-- path) by app/src/security/urlSafety.ts, step 5. Never read on the redirect
-- hot path.
--
-- Runs once on first Postgres boot via /docker-entrypoint-initdb.d (after
-- 001_schema.sql, by filename order). Also safe to apply BY HAND to an existing
-- database — the CREATE is idempotent.
--
-- Matching (see urlSafety.checkDomainBlocklist): a request to host `h` is
-- blocked when a row's `domain` equals `h` OR equals `.` || `h`. Store either
-- "evil.com" or ".evil.com" to block that exact host.
-- =============================================================================
CREATE TABLE IF NOT EXISTS blocked_domains (
    id        SERIAL       PRIMARY KEY,
    domain    TEXT         UNIQUE NOT NULL,
    added_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
