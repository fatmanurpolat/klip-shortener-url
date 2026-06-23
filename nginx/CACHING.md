# nginx redirect micro-caching

Optional nginx-level micro-cache that absorbs viral traffic spikes on the short-link
hot path (`GET /:code`) **without any app code in the request path** — a cache HIT is
served entirely by nginx, never touching Fastify/Postgres/Redis.

Configured in `nginx/conf.d/klip.conf`, `location /`. The cache zone `redirects` is
declared at the top of that file.

## What gets cached (and what doesn't)

| Response | App `Cache-Control` | nginx behavior |
| --- | --- | --- |
| **302** redirect (analytics-on, default link) | `no-store` | **NOT cached** — nginx honors `no-store`, so every click reaches the app and is counted. |
| **301** redirect (analytics-off, `prefer_301`) | `public, max-age=31536000` | **Cached** (`proxy_cache_valid 301 10m`). These already bypass the server via browser/CDN caching anyway. |
| **Webview interstitial** (200 HTML, UA-specific) | `no-store` | **NOT cached** — must stay UA-specific. |
| **404 / 410** (unknown / expired code) | — | Cached `30s` — absorbs floods of bad codes. |
| **5xx** (upstream blip) | — | Cached `1s` — brief shield. |
| **Authenticated** request (`Authorization` or any cookie) | — | **Bypassed** (`proxy_cache_bypass`/`proxy_no_cache`). |

The cache key is `"$scheme$host$request_uri"` — **User-Agent is deliberately excluded**.
That's safe here because the two UA-dependent responses (the webview interstitial and the
analytics 302) are both `no-store`, so they are never stored and can't be cross-served from
one cache entry.

## How to verify

> Use a **301 (analytics-off) link or a 404** to observe a HIT — analytics **302s are
> `no-store` and will always show `MISS`** (that's intentional; see the tradeoff below).

```bash
# Pick a 301/analytics-off short code (or any unknown code for the 404 path).
curl -sI https://<your-domain>/<code> | grep -i x-cache-status   # 1st: X-Cache-Status: MISS
curl -sI https://<your-domain>/<code> | grep -i x-cache-status   # 2nd (within TTL): HIT
# wait past the TTL (10m for 301, 30s for 404)...
curl -sI https://<your-domain>/<code> | grep -i x-cache-status   # EXPIRED, then MISS again
```

`X-Cache-Status` values: `MISS` (fetched + stored), `HIT` (served from cache), `EXPIRED`
(stale, refetched), `BYPASS` (auth/cookie — not served from cache), `STALE`.

Validate the config syntax after deploy: `docker compose exec nginx nginx -t`.

## Analytics tradeoff (explicit)

A short cache window means clicks served from cache are **not individually counted** — within
a TTL, N cached clicks register as ~1 upstream event. **This currently does NOT affect
analytics**, because analytics **302s are sent `no-store`** and are never cached, so every
tracked click reaches the app.

If you later decide spike-absorption on **302** links is worth the accuracy cost, you can
opt in deliberately by removing the `Cache-Control: no-store` on the 302 path in
`app/src/routes/redirect.ts` (or `proxy_ignore_headers Cache-Control` in nginx). With
`proxy_cache_valid 302 5s`, a viral 302 link would then be undercounted by up to ~5s of
clicks per window. This is an **opt-in** decision — it is intentionally OFF by default so
analytics stay exact.

## Deployment notes

`docker-compose.yml` mounts `./nginx/conf.d:/etc/nginx/conf.d:ro` (the production TLS
`klip.conf`), and `nginx.conf` does `include /etc/nginx/conf.d/*.conf`, so this cache + the
DNS-discovered upstream + the `/:code` proxy **are loaded by default**.

- **Local dev:** `docker-compose.override.yml` shadows that mount with `./nginx/conf.d.local`
  (HTTP-only, no certs) so the stack comes up on `http://localhost` without TLS material.
- **Production:** the `:443` block in `conf.d/klip.conf` needs real certs — mount them by
  uncommenting `- ./nginx/certs:/etc/nginx/certs:ro` and providing `fullchain.pem` /
  `privkey.pem` (e.g. via certbot). The `:80` block already serves the ACME HTTP-01 challenge.

Both configs use Docker-DNS service discovery for the app upstream (a variable `proxy_pass` +
`resolver 127.0.0.11`), so `docker compose up --scale app=N` is load-balanced with no nginx
reload — see `docs/deploy.md`.
