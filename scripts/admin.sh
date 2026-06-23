#!/usr/bin/env bash
# =============================================================================
# Klipo admin CLI — talks to the app's INTERNAL /admin API from INSIDE the app
# container. The app port isn't published to the host, and nginx blocks /admin/
# from outside, so this is the supported way to drive abuse tooling locally.
#
# ADMIN_SECRET is read from the running app container's environment, so it is
# never typed on the command line or printed here.
#
# Usage:
#   scripts/admin.sh disable <code> [reason]     # turn a short link off
#   scripts/admin.sh block   <domain> [reason]   # blocklist a domain (future shortens)
#   scripts/admin.sh audit   [code]              # recent shorten audit log (optionally by code)
#
# Env overrides: COMPOSE_FILE (default: ../docker-compose.yml)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/../docker-compose.yml}"
cmd="${1:-}"; shift || true

# Run a small fetch() snippet inside the app container. ADMIN_SECRET comes from
# the container env; extra inputs are passed as -e VARS so they're never baked
# into the script string.
print_result='async r=>{const t=await r.text();let b;try{b=JSON.stringify(JSON.parse(t),null,2)}catch{b=t}console.log("HTTP "+r.status+"\n"+b)}'

case "$cmd" in
  disable)
    code="${1:?usage: admin.sh disable <code> [reason]}"; reason="${2:-}"
    docker compose -f "$COMPOSE_FILE" exec -T -e CODE="$code" -e REASON="$reason" app node -e '
      const b={code:process.env.CODE}; if(process.env.REASON) b.reason=process.env.REASON;
      fetch("http://localhost:3000/admin/disable-link",{method:"POST",
        headers:{"content-type":"application/json","x-admin-secret":process.env.ADMIN_SECRET},
        body:JSON.stringify(b)}).then('"$print_result"').catch(e=>{console.error(e);process.exit(1)});'
    ;;
  block)
    domain="${1:?usage: admin.sh block <domain> [reason]}"; reason="${2:-}"
    docker compose -f "$COMPOSE_FILE" exec -T -e DOMAIN="$domain" -e REASON="$reason" app node -e '
      const b={domain:process.env.DOMAIN}; if(process.env.REASON) b.reason=process.env.REASON;
      fetch("http://localhost:3000/admin/block-domain",{method:"POST",
        headers:{"content-type":"application/json","x-admin-secret":process.env.ADMIN_SECRET},
        body:JSON.stringify(b)}).then('"$print_result"').catch(e=>{console.error(e);process.exit(1)});'
    ;;
  audit)
    code="${1:-}"
    docker compose -f "$COMPOSE_FILE" exec -T -e CODE="$code" app node -e '
      const q=process.env.CODE?("?code="+encodeURIComponent(process.env.CODE)):"";
      fetch("http://localhost:3000/admin/audit"+q,{headers:{"x-admin-secret":process.env.ADMIN_SECRET}})
        .then('"$print_result"').catch(e=>{console.error(e);process.exit(1)});'
    ;;
  *)
    echo "usage: $0 {disable <code> [reason] | block <domain> [reason] | audit [code]}" >&2
    exit 2
    ;;
esac
