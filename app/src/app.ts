import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';
import { getPool, getRedis, closeDb } from './db';
import { registerHealthRoutes } from './routes/health';

declare module 'fastify' {
  interface FastifyInstance {
    pg: Pool;
    redis: Redis;
  }
}

/**
 * Build a fully wired Fastify instance: backing stores, plugins, and routes.
 * Connections come from the shared db module and are closed via the onClose
 * hook so `app.close()` is sufficient for a clean shutdown.
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    trustProxy: true,
  });

  const pool = getPool();
  pool.on('error', (err) => app.log.error({ err }, 'postgres pool error'));

  const redis = getRedis();
  redis.on('error', (err) => app.log.error({ err }, 'redis client error'));

  app.decorate('pg', pool);
  app.decorate('redis', redis);

  await app.register(formbody);
  await registerHealthRoutes(app);

  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app;
}
