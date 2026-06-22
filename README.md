# Klipo

A self-hostable URL shortener with webview escaping. TypeScript + Fastify, fronted by
nginx, backed by Postgres and Redis. Everything runs via Docker Compose.

## Architecture

```
client ──▶ nginx (80/443) ──▶ app (Fastify, :3000) ──┬─▶ postgres (links + clicks)
                                                       └─▶ redis (counter + cache)
```

Only **nginx** publishes ports. `app`, `postgres`, and `redis` are reachable only on the
internal `klip_net` Docker network.

## Quick start

```bash
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD, a matching password in DATABASE_URL, and HASHIDS_SALT
docker compose up -d --build
```

Then check health:

```bash
curl -i http://localhost/healthz        # via nginx
docker compose ps                        # all services should be "healthy"
```

## Layout

| Path                | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `app/`              | Fastify TypeScript backend                         |
| `nginx/`            | nginx reverse-proxy + cache config                 |
| `db/`               | SQL run once on first Postgres init                |
| `web/`              | Static frontend placeholder                        |
| `docker-compose.yml`| 4-service stack                                    |

## Local development (without Docker)

```bash
cd app
npm install
npm run dev            # tsx watch, reads ../.env via dotenv
```

## TLS

Port `443` is published by the `nginx` service. Drop `fullchain.pem` / `privkey.pem` into
`nginx/certs/` and enable the commented `server { listen 443 ssl; ... }` block in
`nginx/nginx.conf`.
# klipo-shortener-url
