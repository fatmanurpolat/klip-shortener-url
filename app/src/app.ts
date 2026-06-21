import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';
import { getPool, getRedis, closeDb } from './db';
import { registerHealthRoutes } from './routes/health';
import { registerShortenRoutes } from './routes/shorten';
import { registerRedirectRoutes } from './routes/redirect';

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

  // CORS: lets the browser-served UI call this API cross-origin during local
  // dev (e.g. UI on http://localhost → API on http://localhost:3000). For
  // production behind nginx (same origin) this is harmless. Reflects the
  // request origin; tighten to an allowlist before exposing publicly.
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST'],
  });

  await app.register(formbody);
  await registerHealthRoutes(app);
  await registerShortenRoutes(app);
  await registerRedirectRoutes(app); // parametric /:code — register last

  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app;
}
