import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { register } from '../metrics';

/**
 * GET /metrics — Prometheus text exposition. INTERNAL ONLY: nginx blocks this
 * path from the public (see nginx/conf.d/klip.conf), and Prometheus scrapes the
 * app directly on the Docker network. No rate limit (trusted scraper); logged at
 * 'warn' so frequent scrapes don't flood the request log.
 */
async function handleMetrics(_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
  reply.type(register.contentType);
  return reply.send(await register.metrics());
}

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', { logLevel: 'warn' }, handleMetrics);
}
