#!/usr/bin/env bash
# =============================================================================
# Klipo — partition presence check (for monitoring / alerting).
#
# Verifies that NEXT month's partition exists for BOTH links and clicks. Exits 0
# if present, 1 if either is missing (so a monitor can alert before inserts start
# failing — these tables have no DEFAULT partition). The "next month" math is done
# in SQL (to_regclass) so it's portable across GNU/BSD date.
#
# Env overrides: COMPOSE_FILE, PGUSER, PGDB (same defaults as roll-partitions.sh).
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
PGUSER="${PGUSER:-klip}"
PGDB="${PGDB:-klip}"

# One row per MISSING partition for next month; empty output means all present.
missing="$(
  docker compose -f "${COMPOSE_FILE}" exec -T postgres \
    psql -U "${PGUSER}" -d "${PGDB}" -tA -c "
      SELECT t || '_' || to_char(now() + interval '1 month', 'YYYY_MM')
      FROM (VALUES ('links'), ('clicks')) AS x(t)
      WHERE to_regclass('public.' || t || '_' || to_char(now() + interval '1 month', 'YYYY_MM')) IS NULL;
    "
)"

if [ -n "${missing//[$'\n\r\t ']/}" ]; then
  echo "CRITICAL: next-month partition(s) MISSING — run scripts/roll-partitions.sh:"
  printf '%s\n' "${missing}" | sed '/^[[:space:]]*$/d; s/^/  - /'
  exit 1
fi

echo "OK: next-month partitions exist for links and clicks ($(date -u '+%Y-%m-%d'))"
exit 0
