# Partition maintenance

`links` and `clicks` are monthly RANGE partitions on `created_at` with **no DEFAULT
partition** — so a partition for a month MUST exist before any row for that month is
inserted, or the INSERT fails. These scripts keep partitions provisioned ahead and
prune ones past their retention window.

## Files

| File | What it does |
| --- | --- |
| `create_month_partition.sql` | Idempotent plpgsql function: creates one `<table>_YYYY_MM` partition if absent. Run once (or every run — `CREATE OR REPLACE`). |
| `roll_partitions.sql` | Creates current + next 2 months for `links` & `clicks`; drops partitions whose **entire** month is past retention. Idempotent. |
| `../../scripts/roll-partitions.sh` | Wrapper: pipes both SQL files into the Postgres container, passing retention from `.env`. The scheduled entry point. |
| `../../scripts/check-partitions.sh` | Monitoring: exits `1` if **next** month's partition is missing for either table. |
| `klip-partitions.cron` | cron.d entry — runs the wrapper at 03:10 on the 1st of each month. |

## Retention

From `.env` (defaults match the app): `RAW_CLICK_RETENTION_DAYS` (90) for `clicks`,
`LINK_RETENTION_MONTHS` (120 = 10y) for `links`. A partition is dropped only once its
**month-end** is past the cutoff — i.e. when *all* of its rows are older than retention,
never deleting data still inside the window.

## Run it

```bash
./scripts/roll-partitions.sh                 # create-ahead + prune (idempotent)
./scripts/check-partitions.sh                # monitoring probe (exit 1 = alert)

# one-off override:
ENV_FILE=/path/.env COMPOSE_FILE=/opt/klip/docker-compose.yml ./scripts/roll-partitions.sh
```

## Install the cron

```bash
sudo cp db/maintenance/klip-partitions.cron /etc/cron.d/klip-partitions
sudo chown root:root /etc/cron.d/klip-partitions && sudo chmod 0644 /etc/cron.d/klip-partitions
```

Edit the `/opt/klip` path inside the file if your deploy lives elsewhere. Pair
`check-partitions.sh` with your monitoring (cron + alert on non-zero exit) as a safety net.

> Note: the cron runs the **wrapper**, not `psql -f /docker-entrypoint-initdb.d/…` — the
> `db/maintenance/*.sql` files aren't mounted into the container, so the wrapper streams them
> in over stdin instead.
