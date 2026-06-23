# Deploying & scaling Klipo

Klipo's `app` service is **stateless and horizontally scalable**. You can run any
number of `app` replicas behind the bundled nginx, scale them up and down at
runtime, and roll out new versions with zero downtime.

---

## 1. Why the app scales (statelessness audit)

Every piece of request-affecting state lives in a **shared backing store**, never
in a single app process:

| Concern | Where it lives | Multi-instance safe? |
|---|---|---|
| URL cache / disabled markers | Redis (`klipo:url:*`) | ✅ shared |
| ID counter | Redis `INCR klipo:counter` (atomic) | ✅ shared |
| Rate limits | Redis fixed-window Lua, keyed by IP/user | ✅ global, not per-instance |
| Sessions | **Stateless** HS256 JWTs signed with `SESSION_SECRET` | ✅ any replica validates any session — **no sticky sessions** |
| Magic-link tokens | Stateless JWTs (not stored) | ✅ |
| Click analytics | **In-process** queue, batch-flushed every 2s | ✅ each replica flushes independently; the `clicks_daily` rollup UPSERTs with `clicks = clicks_daily.clicks + excluded.clicks`, which is atomic under concurrent writers |

Two properties make this work and are enforced in code:

- **Shared secrets must be identical across replicas.** `SESSION_SECRET`,
  `HASHIDS_SALT`, and `ADMIN_SECRET` come from the same `.env`, so every replica
  signs/verifies identically. If they ever diverge, sessions and codes break.
- **Graceful shutdown drains the click queue.** On `SIGTERM` the app flushes its
  in-memory click buffer before the DB pool closes (`stopClickWriter()` in
  `app/src/analytics/clickWriter.ts`), so a scale-down or rolling deploy doesn't
  silently drop up to ~2s of clicks per replica.

---

## 2. Scaling

```bash
docker compose up -d --scale app=3
```

The `app` service has **no `container_name`** and binds **no host port** (it uses
`expose`, not `ports`), so replicas coexist. nginx discovers them automatically —
see below.

### How nginx finds the replicas (Docker DNS service discovery)

nginx does **not** use a static `upstream { server app:3000; }` block. Instead it
proxies to a **variable** upstream and lets Docker's embedded DNS resolve the
service name to the live set of container IPs (`nginx/conf.d/klip.conf`):

```nginx
resolver 127.0.0.11 valid=5s ipv6=off;   # Docker's internal DNS
...
set $klip_upstream app:3000;
proxy_pass http://$klip_upstream;          # re-resolved per request
```

Because the upstream is a variable, nginx re-resolves `app` at request time
(cached for `valid=5s`). Scaling up or down is picked up within ~5s with **no
nginx reload**. Docker DNS returns the container IPs round-robin, so load is
spread across replicas.

> **Why not the static `upstream{ server app:3000; }` form?** In nginx OSS a
> hostname inside an `upstream{}` block is resolved **once at config load** and is
> never re-resolved at runtime — the `resolver` directive has no effect on it
> (runtime re-resolution of upstream servers is an nginx **Plus** feature,
> `server app:3000 resolve;`). With the static form you must
> `docker compose exec nginx nginx -s reload` after every scale change.

### Trade-offs of the dynamic (variable) upstream

- **No upstream keepalive pool.** A variable `proxy_pass` can't use an
  `upstream{ keepalive }` block, so each proxied request opens a fresh TCP hop to
  the app. On the same Docker bridge this is sub-millisecond, and most redirects
  are served from nginx's micro-cache anyway.
- **No active health checks.** nginx OSS has none (that's nginx Plus). Resilience
  is **passive**:
  - Docker DNS stops returning a dead container's IP within `valid=5s`.
  - `proxy_next_upstream error timeout http_502 http_503 http_504;` retries the
    next resolved address on a failed connection.

If you need keepalive **and** `max_fails`/`fail_timeout` passive checks, switch to
a static `upstream{ server app:3000; keepalive 64; }` block and add a
`nginx -s reload` to your scale/deploy steps. For an alternative with built-in
active health checks, front the app with **Caddy** or **Traefik** instead of
nginx OSS.

---

## 3. Capacity: Postgres connections

Each replica opens a Postgres pool of `PG_POOL_MAX` connections (default **10**).
Total server connections ≈ **replicas × `PG_POOL_MAX`**, and Postgres's default
`max_connections` is **100**.

| Replicas | `PG_POOL_MAX` | Total | OK vs default 100? |
|---|---|---|---|
| 3 | 10 | 30 | ✅ |
| 6 | 10 | 60 | ✅ |
| 9 | 10 | 90 | ⚠️ near the limit |
| 12 | 10 | 120 | ❌ raise `max_connections` or lower `PG_POOL_MAX` |

Tune via `.env`:

```dotenv
PG_POOL_MAX=8
```

…or raise Postgres `max_connections` (and `shared_buffers` accordingly), or put
**PgBouncer** in front of Postgres for transaction pooling at high replica counts.

---

## 4. Metrics with multiple replicas

`/metrics` is per-replica (each process has its own counters). Scraping
`app:3000/metrics` over Docker DNS hits a **random** replica, giving partial
numbers. Point Prometheus at **all** replicas via DNS service discovery so it
scrapes each one:

```yaml
scrape_configs:
  - job_name: klipo-app
    dns_sd_configs:
      - names: ['tasks.app']   # or ['app'] on the compose bridge
        type: A
        port: 3000
```

(Use `tasks.<service>` on Docker Swarm; on a plain compose bridge the service
name `app` resolves to all replica IPs.) Aggregate across instances in PromQL
with `sum(...) without (instance)`.

---

## 5. Zero-downtime deploy

The app drains in-flight requests and flushes its click queue on `SIGTERM`, so
replacing replicas one at a time never drops traffic or buffered clicks.

```bash
# 1. Pull the new image.
docker compose pull

# 2. Bring up the new version ALONGSIDE the old (now 2 replicas, mixed versions).
#    nginx starts routing to the new replica within ~5s (Docker DNS).
docker compose up -d --no-deps --scale app=2 app

# 3. Wait until the new replica is healthy.
docker compose ps app          # STATUS should show (healthy)

# 4. Drain back to a single replica. Compose stops the OLD container; it receives
#    SIGTERM, finishes in-flight requests, flushes clicks, then exits. nginx stops
#    routing to it within ~5s.
docker compose up -d --scale app=1 app
```

Run a DB migration first if the release needs one (migrations are
forward-compatible, applied via `db/init` on a fresh volume or by hand on an
existing one), then deploy the app.

> Keep at least 2 replicas during the swap if you want continuous capacity; for a
> larger fleet, raise the scale by one, wait healthy, then lower by one, repeating
> until every container runs the new image.

---

## 6. Quick verification

```bash
docker compose up -d --scale app=3
docker compose ps app                      # 3 × (healthy)

# Hit a public endpoint repeatedly; the app logs its hostname (container id),
# so distinct ids prove requests are spread across replicas.
for i in $(seq 1 12); do curl -s -o /dev/null http://localhost/healthz; done
docker compose logs --since=15s app | grep -o '"hostname":"[^"]*"' | sort | uniq -c

# nginx config is valid and reloads cleanly.
docker compose exec nginx nginx -t
```
