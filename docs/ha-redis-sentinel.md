# Redis high availability with Sentinel

Klipo runs Redis as a **Sentinel-managed cluster** so a single Redis node is no
longer a point of failure for the ID counter, the URL cache, or rate limits.

## Topology

```
            ┌───────────────┐  async replication   ┌──────────────────┐
 app ──┐    │ redis-master  │ ───────────────────▶ │ redis-replica-1  │
       │    │   (writes)    │ ───────────────────▶ │ redis-replica-2  │
       │    └───────────────┘                      └──────────────────┘
       │            ▲  monitor                         ▲   ▲
       │            │                                  │   │
       └─▶ Sentinel x3 (quorum 2) ───────────────────┘───┘
           redis-sentinel-1 / -2 / -3
```

- **1 master + 2 replicas**, all with AOF (`appendfsync everysec`).
- **3 Sentinels, quorum 2**: at least two must agree the master is down before a
  failover is authorized (prevents a single flaky Sentinel from flapping).
- The app connects to **Sentinel**, not a fixed node, and follows failover
  automatically — no app reconfiguration when the master changes.

## How the app connects

`app/src/db.ts` builds the ioredis client in Sentinel mode when `REDIS_SENTINELS`
is set (it is, in `docker-compose.yml`):

```
REDIS_SENTINELS=redis-sentinel-1:26379,redis-sentinel-2:26379,redis-sentinel-3:26379
REDIS_MASTER_NAME=klip-master      # must match `sentinel monitor <name>`
```

If `REDIS_SENTINELS` is **unset**, the client falls back to single-node
`REDIS_URL` — that's what the local-dev workflow (`app/.env`,
`REDIS_URL=redis://localhost:6379`) and the unit tests use.

## The ID counter and the "no duplicate ID" guarantee

The counter is the one piece of state where a duplicate would be a real bug
(two links sharing an id corrupts analytics and code resolution). Klipo defaults
to **`COUNTER_BACKEND=postgres`** precisely so this guarantee is **absolute**:

- IDs come from a Postgres **sequence** (`nextval('link_id_seq')`) — durable and
  HA via Postgres itself, with **no async-replication window at all**. A Redis
  master failover cannot affect it: `getNextId()` for this backend never touches
  Redis, so IDs keep incrementing straight through a failover. (Verified live —
  see the test below.)
- On startup the app fast-forwards the sequence **past `MAX(link_id)`**
  (`counter.ts` `initPostgresCounter`), so a Postgres restore — or *switching to
  this backend from the Redis counter* — can never reissue an existing id. It
  resets a never-used sequence to `MAX(link_id)` and otherwise only raises it
  (`GREATEST(last_value, MAX)`), which keeps concurrent boots / `--scale app=N`
  safe.
- Sentinel still earns its keep here: it provides HA for the **cache** and
  **rate limits**, which is most of Redis's job.

> **Why not the Redis counter by default?** `COUNTER_BACKEND=redis` is supported
> and *safe in practice* — the app re-runs the `MAX(link_id)+1` fast-forward on
> every Sentinel failover (`registerFailoverRecovery`, gating `getNextId` on a
> `recoveryBarrier`). But it is **not absolute**: Redis replication is async, and
> ioredis drains its offline queue onto a freshly promoted master one event-loop
> tick *before* the recovery barrier is set, so an INCR queued during the outage
> can still read a stale counter. The Postgres sequence has no such window, so it's
> the default. (`COUNTER_OFFSET` **must be 0** for either backend.)

## What happens during a failover (~5–10s)

Between the master dying and the new master being elected (`down-after 5s` +
election), there's a brief window:

- **ID issuance is unaffected** (default Postgres backend) — `shorten` keeps
  minting strictly-increasing ids from the Postgres sequence regardless of Redis.
- **Redirects (hot path) keep working.** A failed cache read falls back to
  Postgres (`redirect.ts`), and the redirect rate limiter fails *open*.
- **Writes (shorten) may briefly fail with 503** — not from the counter, but
  because the shorten/auth **rate limiters fail closed** when they can't reach
  Redis. Clients should retry; they succeed once the new master is up.
- **Liveness is not affected.** `/healthz` gates on Postgres only (Redis is
  reported but non-fatal), so the orchestrator won't restart the app mid-failover.
- The app logs transient `redis client error` / `ENOTFOUND redis-master` lines
  during the window — the old master's hostname stops resolving while its
  container is down, until ioredis re-queries Sentinel for the new master. This
  is expected, not a fault.

## Sentinel config notes (`redis/sentinel.conf`)

- The file is mounted **read-only as a template**; each sentinel **copies it to a
  writable path** (`/tmp/sentinel.conf`) before starting, because Sentinel
  rewrites its own config at runtime. A shared RO mount would break that.
- `resolve-hostnames yes` + `announce-hostnames yes`: Sentinel tracks the master
  by the `redis-master` **hostname**, so when a stopped master restarts with a new
  Docker IP it's still found and reconfigured as a replica.

## Failover test plan (and verified results)

Run against the live stack:

```bash
docker compose up -d                                    # 1. everything up
curl -s -X POST localhost/api/v1/shorten -d '{"url":"https://example.com/a"}' \
     -H 'content-type: application/json'                # 2. note the id (A)
docker compose stop redis-master                        # 3. kill the master
# 4. ~5–10s: Sentinel promotes a replica
#    docker compose exec redis-sentinel-1 redis-cli -p 26379 \
#      SENTINEL get-master-addr-by-name klip-master      → new master addr
curl -s -X POST localhost/api/v1/shorten -d '{"url":"https://example.com/b"}' \
     -H 'content-type: application/json'                # 5. succeeds; id (B) > A
docker compose start redis-master                       # 6. rejoins as a REPLICA
docker compose exec redis-master redis-cli INFO replication | grep role  #   role:slave
```

**Observed result** (default Postgres counter backend; baseline `MAX(link_id)` = A):

| Step | Result |
|---|---|
| 2. baseline link | id **16** (A) |
| 4. failover | replica `172.19.0.6` promoted to master in ~5–10s (quorum 2) |
| 5. link after failover | id **17** — greater than 16, **no duplicate**; the id came from the Postgres sequence, unaffected by the Redis failover |
| 6. old master restarted | rejoined as `role:slave`, replica link `up` |
| 7. new master | 2 online replicas (the surviving replica + the rejoined old master); app healthy throughout |

The Sentinel mechanics (promote / rejoin) were also verified with
`COUNTER_BACKEND=redis`, where the failover recovery fast-forwarded the Redis
counter 12 → 13 across the failover. The Postgres backend is the default because
its guarantee is absolute (see above).

## Operational notes

- **Backups** (`scripts/backup.sh`) snapshot the AOF from `redis-master`'s volume.
  After a failover that container is a replica, but it still holds the data, so
  the backup is valid. (AOF exists on every node.)
- **Manual counter recovery** (`scripts/recover-counter.sh`) resolves the
  *current* master via Sentinel before writing (a `SET` on a replica is rejected
  as `READONLY`).
- `num-slaves` reported by `SENTINEL master` may transiently read one high right
  after a failover (stale replica bookkeeping); the master's own
  `INFO replication connected_slaves` is authoritative.
