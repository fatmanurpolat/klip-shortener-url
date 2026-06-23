# Backup & restore runbook

Klipo stores durable data in **Postgres** (links, clicks, users). **Redis** is
mostly a cache — everything in it is reconstructable from Postgres *except* the ID
counter, which has its own recovery step. So backups center on Postgres; Redis is a
convenience snapshot.

All scripts take env overrides: `COMPOSE_FILE`, `PGUSER`, `PGDB`, `BACKUP_DIR`, `ENV_FILE`.

## Back up

```bash
./scripts/backup.sh                      # → /backups/klip/klip-pg-<date>.dump + klip-redis-aof-<date>/
BACKUP_DIR=/mnt/backups ./scripts/backup.sh
```

`pg_dump -Fc` is online and consistent — no downtime. The Redis step triggers
`BGREWRITEAOF` then copies `/data/appendonlydir`. Backups older than 30 days are pruned.

**Cron (nightly 03:30):** `/etc/cron.d/klip-backup`
```cron
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
30 3 * * * root BACKUP_DIR=/backups/klip /opt/klip/scripts/backup.sh >> /var/log/klip-backup.log 2>&1
```
Ship `/backups/klip` off-box (rsync/S3) — a backup on the same disk isn't a backup.

## RPO / RTO

| Store | RPO (data loss window) | RTO (time to restore) |
| --- | --- | --- |
| **Postgres** | last dump (≤24h if nightly). For ≤minutes, add WAL archiving / PITR (`archive_command` → object store) or a managed replica. | minutes — `restore.sh` + app restart |
| **Redis** | ~1s (AOF `appendfsync everysec`). But it's a cache: on total loss, it self-rebuilds; only the counter needs `recover-counter.sh`. | seconds |

## Restore Postgres

> Destructive — drops and recreates `klip`. Stops the app first.

```bash
./scripts/restore.sh /backups/klip/klip-pg-2026-06-23-0330.dump
./scripts/recover-counter.sh        # ALWAYS run after a restore (see below)
```

The restore drops/creates `klip` from the `postgres` maintenance DB (you can't drop a
DB you're connected to) after terminating live connections, then `pg_restore`s and
restarts the app.

## Recover the ID counter (after Redis loss or any restore)

The counter lives in Redis at **`klipo:counter`**. If Redis is wiped — or you restore
Postgres to an older/newer point than Redis — new links could reuse an existing ID.
Fix it:

```bash
./scripts/recover-counter.sh        # sets klipo:counter = MAX(link_id)+1 (or COUNTER_OFFSET if empty)
```

The app also does this automatically on startup (`initCounter`); the script is for
when you can't or don't want to restart, or right after a restore.

## Verify a backup is valid

Restore the dump into a throwaway database (never touch live `klip`) and compare row
counts:

```bash
DUMP=/backups/klip/klip-pg-2026-06-23-0330.dump
docker compose exec -T postgres psql -U klip -d postgres -c "DROP DATABASE IF EXISTS klip_verify;"
docker compose exec -T postgres psql -U klip -d postgres -c "CREATE DATABASE klip_verify OWNER klip;"
docker compose exec -T postgres pg_restore -U klip -d klip_verify --no-owner < "$DUMP"

# Expect a sane, non-zero count that matches production:
docker compose exec -T postgres psql -U klip -d klip_verify -At -c "SELECT count(*) FROM links_code_lookup;"

docker compose exec -T postgres psql -U klip -d postgres -c "DROP DATABASE klip_verify;"
```

A restore that completes without error and shows the expected link count is a good
backup. Do this on a schedule (a backup you've never restored is a hope, not a backup).
