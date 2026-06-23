#!/usr/bin/env bash
# =============================================================================
# Klipo — monthly partition maintenance wrapper.
#
# Applies db/maintenance/{create_month_partition,roll_partitions}.sql against the
# Postgres container: ensures the helper function exists, creates the current +
# next 2 monthly partitions for links & clicks, and drops partitions past their
# retention window. Idempotent — safe to run any time; intended for monthly cron.
#
# Retention comes from .env (RAW_CLICK_RETENTION_DAYS, LINK_RETENTION_MONTHS),
# falling back to the app defaults (90 days / 120 months).
#
# Env overrides:
#   COMPOSE_FILE   path to docker-compose.yml (default: repo docker-compose.yml)
#   PGUSER / PGDB  Postgres role / database  (default: klip / klip)
#   ENV_FILE       path to .env              (default: repo .env)
#
# Exit code: 0 on success, non-zero if any SQL step fails (ON_ERROR_STOP).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"
PGUSER="${PGUSER:-klip}"
PGDB="${PGDB:-klip}"
MAINT_DIR="${REPO_ROOT}/db/maintenance"

log() { printf '%s roll-partitions: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# Read a KEY=value from .env; echo nothing if absent.
read_env() {
  [ -f "${ENV_FILE}" ] || return 0
  grep -E "^$1=" "${ENV_FILE}" | tail -n1 | cut -d= -f2- || true
}

RETENTION_DAYS="$(read_env RAW_CLICK_RETENTION_DAYS)"; RETENTION_DAYS="${RETENTION_DAYS:-90}"
RETENTION_MONTHS="$(read_env LINK_RETENTION_MONTHS)"; RETENTION_MONTHS="${RETENTION_MONTHS:-120}"

# Guard against non-numeric values reaching the SQL (these become psql -v values).
if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  log "ERROR: RAW_CLICK_RETENTION_DAYS='${RETENTION_DAYS}' is not a non-negative integer"; exit 2
fi
if ! [[ "${RETENTION_MONTHS}" =~ ^[0-9]+$ ]]; then
  log "ERROR: LINK_RETENTION_MONTHS='${RETENTION_MONTHS}' is not a non-negative integer"; exit 2
fi

log "applying partitions (clicks retention ${RETENTION_DAYS}d, links retention ${RETENTION_MONTHS}mo)"

# Concatenate the function + roll script and feed via stdin, so the .sql files
# don't need to be mounted into the container.
cat "${MAINT_DIR}/create_month_partition.sql" "${MAINT_DIR}/roll_partitions.sql" \
  | docker compose -f "${COMPOSE_FILE}" exec -T postgres \
      psql -U "${PGUSER}" -d "${PGDB}" \
        -v ON_ERROR_STOP=1 \
        -v raw_click_retention_days="${RETENTION_DAYS}" \
        -v link_retention_months="${RETENTION_MONTHS}"

log "done"
