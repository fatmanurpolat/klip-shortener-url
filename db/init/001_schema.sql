-- =============================================================================
-- Klip — database schema
-- Runs once on first Postgres boot via /docker-entrypoint-initdb.d, and is also
-- safe to apply by hand to an existing database.
--
-- Idempotent: re-running converges to the same end state.
--   * Fresh DB  -> creates everything.
--   * Legacy DB -> migrates the old non-partitioned prototype tables (see §0).
--   * Re-run    -> all CREATEs are no-ops.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Legacy migration (one-time, self-healing)
--    The original prototype created links / clicks / click_daily as PLAIN
--    tables. They block the partitioned definitions below, so drop them iff
--    they currently exist as ORDINARY tables (relkind = 'r'). Partitioned
--    versions (relkind = 'p') are left untouched, which keeps this idempotent.
--    NOTE: this discards any rows in those legacy tables.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    -- old rollup table (renamed to clicks_daily in this schema)
    IF EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = 'click_daily'
          AND relnamespace = 'public'::regnamespace
          AND relkind = 'r'
    ) THEN
        EXECUTE 'DROP TABLE click_daily CASCADE';
        RAISE NOTICE 'Dropped legacy table click_daily';
    END IF;

    -- old non-partitioned links
    IF EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = 'links'
          AND relnamespace = 'public'::regnamespace
          AND relkind = 'r'
    ) THEN
        EXECUTE 'DROP TABLE links CASCADE';
        RAISE NOTICE 'Dropped legacy non-partitioned table links';
    END IF;

    -- old non-partitioned clicks
    IF EXISTS (
        SELECT 1 FROM pg_class
        WHERE relname = 'clicks'
          AND relnamespace = 'public'::regnamespace
          AND relkind = 'r'
    ) THEN
        EXECUTE 'DROP TABLE clicks CASCADE';
        RAISE NOTICE 'Dropped legacy non-partitioned table clicks';
    END IF;
END $$;


-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive email


-- -----------------------------------------------------------------------------
-- 2. users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email         CITEXT       UNIQUE NOT NULL,
    password_hash TEXT,                       -- nullable: magic-link users have no password
    display_name  TEXT,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Keep users.updated_at current on every UPDATE.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- -----------------------------------------------------------------------------
-- 3. links  — range-partitioned MONTHLY by created_at
--    The PRIMARY KEY must include the partition key (created_at).
--    short_code is NOT globally unique here; uniqueness is enforced by
--    links_code_lookup (a partitioned table cannot carry a global unique
--    constraint that excludes its partition key).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
    id          BIGINT       NOT NULL,                       -- counter value (integer ID)
    short_code  TEXT         NOT NULL,
    long_url    TEXT         NOT NULL,
    owner_id    UUID         REFERENCES users(id) ON DELETE SET NULL,
    is_private  BOOLEAN      NOT NULL DEFAULT FALSE,
    prefer_301  BOOLEAN      NOT NULL DEFAULT FALSE,          -- TRUE = analytics off, cacheable redirect
    expires_at  TIMESTAMPTZ,                                  -- NULL = never expires
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);


-- -----------------------------------------------------------------------------
-- 4. links_code_lookup  — global (NOT partitioned)
--    Single source of truth for short_code -> link_id resolution and the
--    place where short_code uniqueness is enforced globally. created_at lets
--    the app route to the correct monthly partition of `links`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links_code_lookup (
    short_code  TEXT         PRIMARY KEY,
    link_id     BIGINT       NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL
);


-- -----------------------------------------------------------------------------
-- 5. clicks  — range-partitioned MONTHLY by created_at
--    No FK to links: the parent's PK is composite (id, created_at) and spans
--    partitions, so clicks reference link_id by value only.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
    id          BIGINT       GENERATED ALWAYS AS IDENTITY,
    link_id     BIGINT       NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ip_hash     BYTEA,                                        -- salted hash, never the raw IP
    country     TEXT,                                         -- 2-letter ISO code
    referer     TEXT,
    ua_browser  TEXT,
    ua_os       TEXT,
    ua_device   TEXT,                                         -- desktop | mobile | tablet | bot
    ua_network  TEXT,                                         -- webview network (instagram, …); null if not a webview
    is_webview  BOOLEAN      NOT NULL DEFAULT FALSE,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);


-- -----------------------------------------------------------------------------
-- 6. clicks_daily  — rollup (NOT partitioned)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks_daily (
    link_id  BIGINT  NOT NULL,
    day      DATE    NOT NULL,
    country  TEXT    NOT NULL DEFAULT '',
    clicks   BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (link_id, day, country)
);


-- -----------------------------------------------------------------------------
-- 7. Indexes
--    Indexes on partitioned tables (links, clicks) are themselves partitioned
--    and propagate automatically to every current and future partition.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_links_short_code   ON links (short_code);
CREATE INDEX IF NOT EXISTS idx_links_owner        ON links (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_links_expires      ON links (expires_at) WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clicks_link        ON clicks (link_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_clicks_daily_link  ON clicks_daily (link_id, day);


-- -----------------------------------------------------------------------------
-- 8. Initial monthly partitions — current month + next 2 (2026-06 .. 2026-08).
--    Upper bound is exclusive, so each range ends on the 1st of the next month.
--    Add future partitions on a schedule (cron / pg_partman) before they fill.
-- -----------------------------------------------------------------------------
-- links
CREATE TABLE IF NOT EXISTS links_2026_06 PARTITION OF links
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS links_2026_07 PARTITION OF links
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS links_2026_08 PARTITION OF links
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

-- clicks
CREATE TABLE IF NOT EXISTS clicks_2026_06 PARTITION OF clicks
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS clicks_2026_07 PARTITION OF clicks
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS clicks_2026_08 PARTITION OF clicks
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');


-- -----------------------------------------------------------------------------
-- 9. Postgres sequence fallback for link IDs (used when COUNTER_BACKEND=postgres;
--    otherwise Redis owns the counter). Starts at the same offset as the app.
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS link_id_seq START WITH 14776336;
