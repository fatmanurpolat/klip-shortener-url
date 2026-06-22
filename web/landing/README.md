# Klipo — landing page

The public marketing + shorten page for Klipo, built with **Next.js 15 (App Router)** and
configured for **static export** so it can be served as plain files by the same nginx box that
fronts the API.

It implements the **Klipo Design System** (imported from the team's `claude.ai/design` project):
the soft floral watercolor palette (rose / lavender / periwinkle / cream / plum), Playfair Display +
Inter + Space Mono + Geist Mono type, and the signature petal gradient. The hero's shorten widget and
the closing magic-link form are wired to the **real** Klipo API.

## Stack

- Next.js 15 + React 19, TypeScript, App Router
- `next/font` self-hosts the four families (no CDN); wired to the design-token CSS variables
- `lucide-react` for icons (matches the design system's Lucide choice)
- Design tokens ported verbatim into `app/globals.css`; layout/responsive rules in `app/landing.css`

## Develop

```bash
cd web/landing
npm install
# Point the browser client at the locally-running Fastify API (see app/):
echo 'NEXT_PUBLIC_API_BASE=http://localhost:3000' > .env.local
npm run dev          # http://localhost:4000
```

Run the backend in another terminal (`cd app && npm run dev`, port 3000). The API has CORS enabled
for local dev, so the cross-origin shorten/login calls work.

## Build (static export)

```bash
npm run build        # type-checks, builds, and exports static files to ./out
```

`out/` contains `index.html` + hashed assets — no Node server required at runtime.

## Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE` | `""` (same-origin) | Base URL for API calls. Empty → `/api/v1/...` (production behind nginx). For dev set `http://localhost:3000`. |
| `NEXT_PUBLIC_SHORT_DOMAIN` | `klipo.to` | Short-link domain shown in UI copy. |

## Deploying behind the existing nginx

nginx currently serves `./web` only under `/static/` and proxies `/` (the catch-all) to the Fastify
app for `/:code` short-link redirects. To serve this landing page at `/` **without** breaking
short-code redirects, the cleanest options are:

1. **Serve the export at `/`, keep `/:code` on the app.** Copy `out/` into the nginx web root and add
   an exact-match location *before* the catch-all:

   ```nginx
   # serve the landing page only for the root document
   location = / {
       root /usr/share/nginx/html;   # web/  (mounts ./web)
       try_files /index.html @app;
   }
   location @app { proxy_pass http://klip_app; /* ...standard proxy headers... */ }
   ```

   Next's hashed assets live under `/_next/`; serve them statically too
   (`location /_next/ { root /usr/share/nginx/html; }`) and copy `out/_next` alongside.

2. **Host the landing on its own subdomain/path** (e.g. `www.` or a separate static host) and keep
   `klipo.to/` purely for redirects + the dashboard. Simplest separation of concerns.

> The nginx/docker wiring is intentionally **not** changed in this commit — it's outward-facing infra.
> Pick an option above and apply it as a deliberate deploy step. `npm run build` is all that's needed
> to produce the artifact.

## Structure

```
app/
  globals.css      design tokens (ported) + base + brand keyframes
  landing.css      landing-only layout + responsive media queries
  layout.tsx       fonts (next/font) + metadata
  page.tsx         composes the sections
components/
  ui/              design-system primitives: Button, Card, Input, Badge, Logo, Icon, Section
  ShortenWidget    the working hero CTA (POST /api/v1/shorten)
  landing/         NavBar, Hero, CredibilityStrip, HowItWorks, RescuedMetric, RescuedBar,
                   Sparkline, AnalyticsTeaser, BuiltForBoth, CopyButton, FinalCta, Footer,
                   Reveal, CountUp
lib/
  api.ts           typed Klipo API client (shorten + requestLogin) with on-brand errors
```
