-- Klip schema. Executed once by the postgres image on first initialization
-- (files in /docker-entrypoint-initdb.d run only when the data dir is empty).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------
-- links: one row per short URL
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS links (
    id              BIGINT       PRIMARY KEY,            -- monotonic counter value (hashids -> slug)
    slug            TEXT         NOT NULL UNIQUE,         -- public short code
    target_url      TEXT         NOT NULL,
    title           TEXT,
    webview_escape  BOOLEAN      NOT NULL DEFAULT TRUE,   -- break out of in-app webviews on resolve
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    click_count     BIGINT       NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_links_created_at ON links (created_at);
CREATE INDEX IF NOT EXISTS idx_links_expires_at ON links (expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_links_active     ON links (is_active)  WHERE is_active;

-- ------------------------------------------------------------------
-- clicks: raw click events (pruned per RAW_CLICK_RETENTION_DAYS)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clicks (
    id           BIGSERIAL    PRIMARY KEY,
    link_id      BIGINT       NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    clicked_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ip_hash      TEXT,                                    -- hashed, never store raw IPs
    user_agent   TEXT,
    referer      TEXT,
    country      TEXT,
    is_webview   BOOLEAN,
    was_escaped  BOOLEAN
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id    ON clicks (link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks (clicked_at);

-- ------------------------------------------------------------------
-- click_daily: rollup for dashboards (retained long-term)
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS click_daily (
    link_id   BIGINT  NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    day       DATE    NOT NULL,
    clicks    BIGINT  NOT NULL DEFAULT 0,
    PRIMARY KEY (link_id, day)
);

-- ------------------------------------------------------------------
-- keep updated_at fresh on every UPDATE
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_links_updated_at ON links;
CREATE TRIGGER trg_links_updated_at
    BEFORE UPDATE ON links
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
