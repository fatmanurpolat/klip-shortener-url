-- =============================================================================
-- Klipo — abuse prevention (blocklist reason, link disabling, owner quotas,
-- shorten audit log).
--
-- Idempotent — runs on fresh boot via /docker-entrypoint-initdb.d (after
-- 001/002), and is safe to apply BY HAND to an existing database:
--   docker compose exec -T postgres psql -U klip -d klip -f /path/003_abuse.sql
--   (or stream it in: cat db/init/003_abuse.sql | docker compose exec -T postgres psql -U klip -d klip)
--
-- NOTE: the spec called this db/migrations/002_abuse.sql, but this repo numbers
-- migrations under db/init/ and 002 is already blocked_domains — so it's 003 here.
-- =============================================================================

-- 1. blocked_domains gets a reason (table already created in 002_blocked_domains.sql).
ALTER TABLE blocked_domains ADD COLUMN IF NOT EXISTS reason TEXT;

-- 2. links: disable flag + reason, and the IP prefix of the creator (needed for
--    the anonymous per-IP quota — the spec's quota counts by ip_prefix, but the
--    links table didn't carry it).
ALTER TABLE links ADD COLUMN IF NOT EXISTS is_disabled      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE links ADD COLUMN IF NOT EXISTS disabled_reason  TEXT;
ALTER TABLE links ADD COLUMN IF NOT EXISTS ip_prefix        TEXT;

-- Quota-count support. Anonymous quota: WHERE owner_id IS NULL AND ip_prefix = $1
-- AND active. Partial index keeps it small (only anonymous rows).
CREATE INDEX IF NOT EXISTS idx_links_anon_ipprefix
    ON links (ip_prefix) WHERE owner_id IS NULL;
-- Authenticated quota counts by owner_id — idx_links_owner (001) already covers it.

-- 3. shorten_audit — append-only audit of every successful shorten. Monthly
--    RANGE-partitioned by created_at (same pattern as links/clicks). Written
--    fire-and-forget from the shorten path; pruned by the partition roller.
CREATE TABLE IF NOT EXISTS shorten_audit (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY,
    short_code  TEXT         NOT NULL,
    long_url    TEXT         NOT NULL,
    owner_id    UUID,
    ip_prefix   TEXT,                                  -- /24 for IPv4, /48 for IPv6
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Current-month partition (roll_partitions.sh provisions future months).
CREATE TABLE IF NOT EXISTS shorten_audit_2026_06 PARTITION OF shorten_audit
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

-- Audit query filters: by code, by ip_prefix, by created_at range (partition-pruned).
CREATE INDEX IF NOT EXISTS idx_shorten_audit_code      ON shorten_audit (short_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shorten_audit_ipprefix  ON shorten_audit (ip_prefix, created_at DESC);
