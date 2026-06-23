import { Counter, Histogram, Gauge, register, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics for Klipo. Scraped at GET /metrics (internal only — nginx
 * blocks it from the public; Prometheus reaches the app directly on the Docker
 * network). Metric/label cardinality is kept deliberately low: labels are bounded
 * enum-like values (status, type, result), never the short code or a URL.
 */

// Node.js process metrics (CPU, heap/memory, event-loop lag, GC, open handles).
// Kept under the standard `process_*` / `nodejs_*` names (no prefix) so
// off-the-shelf Grafana dashboards and alerts recognize them. Runs once at
// module load; the registry is a singleton so it's never double-registered.
collectDefaultMetrics();

export const redirectsTotal = new Counter({
  name: 'klip_redirects_total',
  help: 'Total redirects served',
  labelNames: ['status', 'type'] as const, // type: '301'|'302'|'interstitial'|'404'
});

export const cacheHits = new Counter({
  name: 'klip_cache_hits_total',
  help: 'Redis cache hits',
  labelNames: ['result'] as const, // result: 'hit'|'miss'|'tombstone'
});

export const redirectDuration = new Histogram({
  name: 'klip_redirect_duration_seconds',
  help: 'Redirect handler latency',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
});

export const shortenTotal = new Counter({
  name: 'klip_shortens_total',
  help: 'Total links created',
  labelNames: ['type'] as const, // 'generated'|'custom_alias'
});

export const clickQueueDepth = new Gauge({
  name: 'klip_click_queue_depth',
  help: 'Pending click events in memory queue',
});

export { register };
