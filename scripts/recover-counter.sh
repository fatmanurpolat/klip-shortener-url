#!/usr/bin/env bash
# =============================================================================
# Klipo — recover the ID counter after Redis data loss (or after a Postgres
# restore), so newly-issued IDs can NEVER collide with an already-stored link.
#
# The app's ID counter lives in Redis at `klipo:counter` (NOTE: klipo, not klip —
# it was renamed; an old unused `klip:counter` may still linger). This sets it to
# MAX(link_id)+1 from Postgres, or to COUNTER_OFFSET when there are no links yet
# — exactly what the app's own startup recovery (counter.ts initRedisCounter)
# does, so the two never disagree.
#
# Env overrides: COMPOSE_FILE, PGUSER, PGDB, ENV_FILE.
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${REPO_ROOT}/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env}"
PGUSER="${PGUSER:-klip}"
PGDB="${PGDB:-klip}"
COUNTER_KEY="klipo:counter"

dc() { docker compose -f "${COMPOSE_FILE}" "$@"; }

# COUNTER_OFFSET from .env (default 0) — the counter's value space must match the
# app's. With offset 0, link_id == counter value, so MAX(link_id) is the counter.
OFFSET="$(grep -E '^COUNTER_OFFSET=' "${ENV_FILE}" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
OFFSET="${OFFSET:-0}"
[[ "${OFFSET}" =~ ^[0-9]+$ ]] || { echo "[counter-recovery] ERROR: COUNTER_OFFSET='${OFFSET}' is not an integer" >&2; exit 2; }

# MAX(link_id)+1, or OFFSET when the table is empty (NULL+1 -> NULL -> COALESCE).
NEW_VALUE="$(
  dc exec -T postgres psql -U "${PGUSER}" -d "${PGDB}" -At \
    -c "SELECT COALESCE(MAX(link_id) + 1, ${OFFSET}) FROM links_code_lookup;" | tr -d '\r'
)"
[[ "${NEW_VALUE}" =~ ^[0-9]+$ ]] || { echo "[counter-recovery] ERROR: unexpected value '${NEW_VALUE}' from Postgres" >&2; exit 1; }

echo "[counter-recovery] Setting ${COUNTER_KEY} to ${NEW_VALUE} (MAX(link_id)+1, offset ${OFFSET})"

# Write to the CURRENT master. After a Sentinel failover the master is a promoted
# replica, NOT necessarily the `redis-master` container — and a SET on a replica
# is rejected (READONLY). Ask a Sentinel where the master is, then target it.
MASTER_ADDR=""
if dc ps --services 2>/dev/null | grep -qx redis-sentinel-1; then
  MASTER_ADDR="$(dc exec -T redis-sentinel-1 redis-cli -p 26379 \
    SENTINEL get-master-addr-by-name klip-master 2>/dev/null | tr -d '\r')"
fi

if [ -n "${MASTER_ADDR}" ]; then
  MHOST="$(printf '%s\n' "${MASTER_ADDR}" | sed -n 1p)"
  MPORT="$(printf '%s\n' "${MASTER_ADDR}" | sed -n 2p)"
  echo "[counter-recovery] Current master (via Sentinel): ${MHOST}:${MPORT}"
  dc exec -T redis-sentinel-1 redis-cli -h "${MHOST}" -p "${MPORT}" \
    SET "${COUNTER_KEY}" "${NEW_VALUE}" | tr -d '\r'
else
  # Single-node fallback (no Sentinel running): write to the master service.
  dc exec -T redis-master redis-cli SET "${COUNTER_KEY}" "${NEW_VALUE}" | tr -d '\r'
fi

echo "[counter-recovery] Done. The counter will never reuse an existing ID."
