#!/usr/bin/env bash
# =============================================================================
# Klipo — backup: Postgres dump (custom format) + Redis AOF snapshot.
# Idempotent, safe to run on a live system (pg_dump is online/consistent).
# Retains 30 days. Intended for nightly cron.
#
# Env overrides: BACKUP_DIR, COMPOSE_FILE, PGUSER, PGDB.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
PGUSER="${PGUSER:-klip}"
PGDB="${PGDB:-klip}"
BACKUP_DIR="${BACKUP_DIR:-/backups/klip}"
DATE="$(date +%F-%H%M)"

dc() { docker compose -f "${COMPOSE_FILE}" "$@"; }

mkdir -p "${BACKUP_DIR}"

echo "[backup] Starting Postgres dump..."
# -Fc = custom format (compressed, restorable with pg_restore, selective).
dc exec -T postgres pg_dump -U "${PGUSER}" -Fc "${PGDB}" > "${BACKUP_DIR}/klip-pg-${DATE}.dump"
echo "[backup] Postgres dump saved: ${BACKUP_DIR}/klip-pg-${DATE}.dump"

echo "[backup] Snapshotting Redis AOF..."
# Trigger an AOF rewrite to compact the log before copying (NOT 'CONFIG REWRITE',
# which only rewrites redis.conf). Redis is mostly a cache; the only state that
# isn't reconstructable from Postgres is the ID counter — and that is separately
# recoverable via scripts/recover-counter.sh — so this snapshot is a convenience.
dc exec -T redis redis-cli BGREWRITEAOF >/dev/null || true
# Give the background rewrite a moment to settle (best-effort; AOF is append-only
# so an in-flight copy is still consistent enough to restore from).
sleep 2
dc cp redis:/data/appendonlydir "${BACKUP_DIR}/klip-redis-aof-${DATE}"
echo "[backup] Redis AOF saved: ${BACKUP_DIR}/klip-redis-aof-${DATE}"

echo "[backup] Pruning backups older than 30 days..."
find "${BACKUP_DIR}" -maxdepth 1 -name 'klip-pg-*.dump'    -mtime +30 -delete
find "${BACKUP_DIR}" -maxdepth 1 -name 'klip-redis-aof-*'  -mtime +30 -exec rm -rf {} +

echo "[backup] Done."
