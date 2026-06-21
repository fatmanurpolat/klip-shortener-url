import { buildApp } from './app';
import { env } from './env';
import { initCounter } from './counter';

async function main(): Promise<void> {
  const app = await buildApp();

  // Seed/recover the ID counter before we accept any traffic.
  try {
    await initCounter();
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
