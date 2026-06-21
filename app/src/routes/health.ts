import { FastifyInstance } from 'fastify';

/**
 * GET /healthz — liveness/readiness probe used by the Docker Compose healthcheck.
 * Verifies both backing stores and returns 200 only when both respond.
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
      app.log.error({ err }, 'healthz: redis check failed');
    }

    const ok = checks.postgres && checks.redis;
    reply.code(ok ? 200 : 503);
    return { ok, checks };
  });
}
