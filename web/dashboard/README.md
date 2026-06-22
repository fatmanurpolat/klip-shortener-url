# Klipo — dashboard

The creator dashboard for Klipo, built with **Vite + React 18 + TypeScript**. It implements the
**Klipo Design System** ("Klipo" brand) and is wired to the **real** Klipo backend: magic-link auth,
the links list, per-link analytics (including the signature **Webview vs Real Browser** breakdown),
link creation, and deletion.

## Stack

- Vite 5 + React 18 + TypeScript (no router — lightweight local-state view switching, static-host friendly)
- Design tokens ported into `src/styles/tokens.css`; fonts via the Google Fonts CDN (`index.html`)
- `lucide-react` icons; no CSS framework (token CSS + inline styles, faithful to the design system)

## Develop

```bash
cd web/dashboard
npm install
npm run dev          # http://localhost:4100
```

Vite **proxies `/api` → the Fastify app** (default `http://localhost:3000`, see `vite.config.ts`), so
calls are same-origin and the HttpOnly session cookie flows without any CORS dance. Run the backend in
another terminal (`cd app && npm run dev`). Override the proxy target with `VITE_API_TARGET` if needed.

### Signing in (magic link)

1. Enter an email and **send magic link** → calls `POST /api/v1/auth/request-login`.
2. In **dev**, the backend returns the token directly, so an **"open the app (dev)"** button appears —
   it calls `GET /api/v1/auth/verify?token=…`, which sets the session cookie, and you're in.
3. In **production**, you click the link emailed to you. If your magic-link URL points at the dashboard
   with `?token=…`, the app verifies it on load and strips the token from the URL.

## Build

```bash
npm run build        # tsc -b && vite build → dist/
npm run preview      # serve the built dist/ on :4100
```

`base: "./"` keeps asset URLs relative, so `dist/` can be served from a subpath behind nginx.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE` | `""` (same-origin) | API base. Empty → `/api/v1/...`. Set only for a split-origin deploy. |
| `VITE_API_TARGET` | `http://localhost:3000` | Dev-only: where Vite proxies `/api`. |
| `VITE_SHORT_DOMAIN` | `klipo.to` | Short-link domain shown in UI copy. |

## What's wired to the real API vs. local

- **Real:** sign in/out (magic link), the links list (`GET /api/v1/links`, cursor pagination),
  create (`POST /api/v1/shorten`), delete (`DELETE /api/v1/links/:code`), per-link stats
  (`GET /api/v1/links/:code/stats`, including the 301 "analytics off" branch).
- **Local-only (no backend endpoint exists yet):** the Settings preference toggles (escape default,
  notifications, default expiry) are saved on-device only and labelled as such — they're honest stubs
  for a future settings API, not fake persistence. The signed-in email and sign-out are real.
- **Derived client-side:** a link's `live / expiring / expired` status is computed from `expiresAt`
  (the list endpoint returns no status field); "expiring" = within 7 days.

## Deploying behind nginx

nginx serves `./web` under `/static/` and proxies `/` to Fastify for `/:code` redirects. Serve this
SPA from a path (e.g. `/app/`) or its own subdomain, copying `dist/` there; because the app uses
local-state navigation (no client routes), no SPA history rewrite is required. The nginx/docker wiring
is intentionally left unchanged — apply the location as a deliberate deploy step.

## Structure

```
src/
  main.tsx            entry — AuthProvider + ToastProvider + App
  App.tsx             view orchestration (auth gate, screen switch, modal)
  auth/AuthContext    magic-link session (probe + verify), email for the shell
  lib/api.ts          typed Klipo API client + derived helpers (status, relative time)
  screens/            Login, AppShell, Dashboard, LinkStats, Settings, CreateLinkModal
  components/         Toast, Sparkline
  components/ui/      Button, IconButton, Card, Badge, Avatar, Logo, Input, Switch, Select, Icon
  styles/             tokens.css, base.css, app.css
```
