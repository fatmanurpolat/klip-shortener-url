import { FastifyInstance } from 'fastify';

/**
 * GET /healthz — liveness probe used by the Docker Compose healthcheck.
 *
 * LIVENESS hinges on Postgres only. Redis is reported but NOT required for a 200:
 * during a Sentinel failover (~5–10s) Redis is briefly unreachable, yet the app is
 * still serving — redirects fall back to Postgres and the rate limiter degrades
 * gracefully. Treating a Redis blip as "app is dead" would let the orchestrator
 * restart the app mid-failover, which fixes nothing and drops in-flight work. A
 * Postgres failure, by contrast, means the app genuinely can't serve.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async (_request, reply) => {
    const checks = { postgres: false, redis: false };

    try {
      await app.pg.query('SELECT 1');
      checks.postgres = true;
    } catch (err) {
      app.log.error({ err }, 'healthz: postgres check failed');
    }

    try {
      const pong = await app.redis.ping();
      checks.redis = pong === 'PONG';
    } catch (err) {
      // Non-fatal for liveness; logged at warn so a real Redis outage is visible.
      app.log.warn({ err }, 'healthz: redis check failed (non-fatal)');
    }

    const ok = checks.postgres; // Redis is informational, not a liveness gate.
    reply.code(ok ? 200 : 503);
    return { ok, checks };
  });
}
