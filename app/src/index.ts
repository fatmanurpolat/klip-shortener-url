import { buildApp } from './app';
import { env } from './env';
import { initCounter } from './counter';

async function main(): Promise<void> {
  const app = await buildApp();

  // Startup config guard. The HARD requirements — HASHIDS_SALT >= 20 and
  // SESSION_SECRET >= 32 chars — are enforced declaratively in env.ts, which
  // exits(1) before we reach here. This is the one SOFT check that can't live in
  // the env schema (the app connects via DATABASE_URL, not POSTGRES_PASSWORD):
  // shout if the Postgres password is still the compose placeholder in prod.
  if (env.NODE_ENV === 'production' && process.env.POSTGRES_PASSWORD === 'CHANGE_ME') {
    app.log.warn(
      'INSECURE CONFIG: POSTGRES_PASSWORD is still "CHANGE_ME" in production — ' +
        'set a strong, unique password in .env and rotate the database credential now.',
    );
  }

  // Seed/recover the ID counter before we accept any traffic.
  try {
    await initCounter(app.log);
    app.log.info({ backend: env.COUNTER_BACKEND }, 'id counter ready');
  } catch (err) {
    app.log.error({ err }, 'failed to initialize id counter');
    await app.close();
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    app.log.info({ signal }, 'received shutdown signal');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }
}

void main();
