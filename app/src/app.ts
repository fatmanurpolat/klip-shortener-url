import Fastify, { FastifyInstance } from 'fastify';
import formbody from '@fastify/formbody';
import cors from '@fastify/cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './env';
import { getPool, getRedis, closeDb } from './db';
import { registerHealthRoutes } from './routes/health';
import { registerShortenRoutes } from './routes/shorten';
import { registerStatsRoutes } from './routes/stats';
import { registerLinksRoutes } from './routes/links';
import { registerRedirectRoutes } from './routes/redirect';
import { registerAuthRoutes } from './routes/auth';
import { registerAuthHook } from './middleware/authenticate';
import { initClickWriter } from './analytics/clickWriter';

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
    credentials: true, // allow the session cookie cross-origin in dev
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  await app.register(formbody);

  // Populate request.user from a session token on every request (optional auth).
  // Protected routes additionally use the `requireAuth` preHandler.
  registerAuthHook(app);

  await registerHealthRoutes(app);
  await registerAuthRoutes(app);
  await registerShortenRoutes(app);
  await registerStatsRoutes(app);
  await registerLinksRoutes(app);
  await registerRedirectRoutes(app); // parametric /:code — register last

  // Start the background click-batch writer.
  initClickWriter(app.log);

  app.addHook('onClose', async () => {
    await closeDb();
  });

  return app;
}
