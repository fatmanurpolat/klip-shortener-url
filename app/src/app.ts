import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';
import { registerHealthRoutes } from './routes/health';

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
    redis: Redis;
  }
}

/**
 * Build a fully wired Fastify instance: backing stores, plugins, and routes.
 * Connections are closed via the onClose hook so `app.close()` is sufficient
 * for a clean shutdown.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    trustProxy: true,
  });

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
  });
  pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
  });
  redis.on('error', (err) => app.log.error({ err }, 'redis client error'));

  app.decorate('pg', pool);
  app.decorate('redis', redis);

  await app.register(formbody);
  await registerHealthRoutes(app);

  app.addHook('onClose', async () => {
    await pool.end().catch(() => undefined);
    redis.disconnect();
  });

  return app;
}
