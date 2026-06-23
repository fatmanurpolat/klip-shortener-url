-- =============================================================================
-- Klipo — roll_partitions.sql
-- Idempotent monthly partition maintenance. Safe to run any time (cron monthly).
--
--   1. Ensure partitions exist for the current month + next 2 (links & clicks),
--      so data always has a home before it arrives.
--   2. Drop raw `clicks` partitions older than the retention window.
--   3. Drop `links` partitions older than their (much longer) retention window.
--
-- REQUIRES create_month_partition() to exist (see create_month_partition.sql).
-- scripts/roll-partitions.sh applies both files together, so the function is
-- always present when this runs.
--
-- Retention is configurable via psql vars (defaults match the app's env):
--   psql -v raw_click_retention_days=90 -v link_retention_months=120 -f roll_partitions.sql
-- =============================================================================

-- Defaults (only if not supplied via -v), so the file is runnable standalone.
\if :{?raw_click_retention_days} \else \set raw_click_retention_days 90 \endif
\if :{?link_retention_months}    \else \set link_retention_months 120 \endif

-- ---------------------------------------------------------------------------
-- 1. Create current + next 2 months for both partitioned tables.
-- ---------------------------------------------------------------------------
SELECT create_month_partition('links',  date_trunc('month', now())::date);
SELECT create_month_partition('links',  date_trunc('month', now() + interval '1 month')::date);
SELECT create_month_partition('links',  date_trunc('month', now() + interval '2 months')::date);
SELECT create_month_partition('clicks', date_trunc('month', now())::date);
SELECT create_month_partition('clicks', date_trunc('month', now() + interval '1 month')::date);
SELECT create_month_partition('clicks', date_trunc('month', now() + interval '2 months')::date);
SELECT create_month_partition('shorten_audit', date_trunc('month', now())::date);
SELECT create_month_partition('shorten_audit', date_trunc('month', now() + interval '1 month')::date);
SELECT create_month_partition('shorten_audit', date_trunc('month', now() + interval '2 months')::date);

-- psql does NOT interpolate :vars inside $$-quoted DO blocks, so stash the
-- retention values into session GUCs here (plain SQL — substitution works) and
-- read them with current_setting() inside the DO blocks below.
SELECT set_config('klipo.raw_click_retention_days', :'raw_click_retention_days', false);
SELECT set_config('klipo.link_retention_months',    :'link_retention_months',    false);

-- ---------------------------------------------------------------------------
-- 2. Drop raw `clicks` partitions whose ENTIRE month is past retention.
--    We compare the partition's month-END (exclusive upper bound) to the cutoff
--    so a partition is only dropped once ALL of its rows are older than the
--    retention window — never deleting data still inside it.
--    NOTE: right(name, 7) (not substring from 8) — 'clicks_' is 7 chars but
--    'links_' is 6, so a fixed offset of 8 would mis-slice links names.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r       RECORD;
  cutoff  DATE := current_date - make_interval(days => current_setting('klipo.raw_click_retention_days')::int);
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '^clicks_\d{4}_\d{2}$'
      AND (to_date(right(tablename, 7), 'YYYY_MM') + interval '1 month')::date <= cutoff
  LOOP
    RAISE NOTICE 'Dropping old clicks partition: % (cutoff %)', r.tablename, cutoff;
    EXECUTE format('DROP TABLE IF EXISTS %I', r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2b. Drop `shorten_audit` partitions past the same (raw-click) retention — it's
--     high-volume append-only operational data, like clicks.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r       RECORD;
  cutoff  DATE := current_date - make_interval(days => current_setting('klipo.raw_click_retention_days')::int);
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '^shorten_audit_\d{4}_\d{2}$'
      AND (to_date(right(tablename, 7), 'YYYY_MM') + interval '1 month')::date <= cutoff
  LOOP
    RAISE NOTICE 'Dropping old shorten_audit partition: % (cutoff %)', r.tablename, cutoff;
    EXECUTE format('DROP TABLE IF EXISTS %I', r.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Drop `links` partitions past their (default 120-month / 10-year) retention.
--    Same month-END logic and right(name, 7) extraction.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r       RECORD;
  cutoff  DATE := current_date - make_interval(months => current_setting('klipo.link_retention_months')::int);
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename ~ '^links_\d{4}_\d{2}$'
      AND (to_date(right(tablename, 7), 'YYYY_MM') + interval '1 month')::date <= cutoff
  LOOP
    RAISE NOTICE 'Dropping old links partition: % (cutoff %)', r.tablename, cutoff;
    EXECUTE format('DROP TABLE IF EXISTS %I', r.tablename);
  END LOOP;
END $$;
