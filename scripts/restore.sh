#!/usr/bin/env bash
# =============================================================================
# Klipo — restore Postgres from a pg_dump (-Fc) file.
#
#   ./scripts/restore.sh /backups/klip/klip-pg-2026-06-23-0310.dump
#
# DESTRUCTIVE: drops and recreates the `klip` database. It stops the app and
# terminates open connections first, because a database can't be dropped while
# anything (including the app's pool, or the very psql doing the drop) is
# connected to it — the drop/create therefore run against the `postgres`
# maintenance DB, not `klip`.
#
# Env overrides: COMPOSE_FILE, PGUSER, PGDB.
# =============================================================================
set -euo pipefail

DUMP_FILE="${1:?Usage: restore.sh <path-to-dump-file>}"
[ -f "${DUMP_FILE}" ] || { echo "[restore] ERROR: dump file not found: ${DUMP_FILE}" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
PGUSER="${PGUSER:-klip}"
PGDB="${PGDB:-klip}"

dc() { docker compose -f "${COMPOSE_FILE}" "$@"; }
# Run admin SQL against the `postgres` DB (so we're never connected to ${PGDB}).
admin() { dc exec -T postgres psql -U "${PGUSER}" -d postgres -v ON_ERROR_STOP=1 "$@"; }

echo "[restore] Stopping app so it releases its DB connections..."
dc stop app >/dev/null 2>&1 || true

echo "[restore] Terminating remaining connections to ${PGDB}..."
admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = '${PGDB}' AND pid <> pg_backend_pid();" >/dev/null

echo "[restore] Dropping and recreating ${PGDB}..."
admin -c "DROP DATABASE IF EXISTS ${PGDB};"
admin -c "CREATE DATABASE ${PGDB} OWNER ${PGUSER};"

echo "[restore] Restoring from ${DUMP_FILE}..."
dc exec -T postgres pg_restore -U "${PGUSER}" -d "${PGDB}" --no-owner < "${DUMP_FILE}"

echo "[restore] Restarting app..."
dc start app >/dev/null

cat <<EOF
[restore] Done.
[restore] IMPORTANT: align the Redis ID counter with the restored data so new
          links can't reuse a restored ID:
              ./scripts/recover-counter.sh
EOF
