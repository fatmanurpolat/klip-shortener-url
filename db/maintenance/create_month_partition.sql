-- =============================================================================
-- Klipo — create_month_partition()
-- Idempotent helper that creates one monthly RANGE partition of a partitioned
-- table (links / clicks; partition key = created_at) if it does not already
-- exist. Safe to run any number of times.
--
-- Run once at deploy (or let scripts/roll-partitions.sh apply it each run, since
-- CREATE OR REPLACE is idempotent).
--
--   SELECT create_month_partition('clicks', date '2026-09-01');
--   -> creates clicks_2026_09 FOR VALUES FROM ('2026-09-01') TO ('2026-10-01')
-- =============================================================================
CREATE OR REPLACE FUNCTION create_month_partition(table_name TEXT, month_start DATE)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  partition_name TEXT;
  month_end      DATE;
BEGIN
  partition_name := table_name || '_' || to_char(month_start, 'YYYY_MM');
  month_end      := (month_start + INTERVAL '1 month')::date;  -- exclusive upper bound

  -- Only create if a relation of that name does not already exist in public.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = partition_name
      AND n.nspname = 'public'
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
      partition_name, table_name, month_start::text, month_end::text
    );
    RAISE NOTICE 'Created partition: %', partition_name;
  END IF;
END;
$$;
