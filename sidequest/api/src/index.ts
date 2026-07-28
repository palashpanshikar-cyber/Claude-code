import type { Server } from 'node:http';
import { createApp } from './app.js';
import { checkProductionConfig, config } from './lib/config.js';
import { startCron } from './jobs/cron.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';

checkProductionConfig();

const app = createApp();

const server: Server = app.listen(config.port, () => {
  logger.info(
    { port: config.port, storage: config.storage.driver, env: config.env },
    'SideQuest API listening',
  );
});

const cron = config.enableCron ? startCron() : null;

/**
 * Drain in-flight requests before exiting.
 *
 * Every deploy on Railway or Render sends SIGTERM. Without this the process
 * dies mid-request — an upload that was halfway to storage simply vanishes,
 * and the client sees a connection reset rather than an error it can retry.
 */
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Stop taking new work first, so the drain below can actually finish.
  cron?.stop();

  const timer = setTimeout(() => {
    logger.warn('shutdown timed out with requests still open, exiting anyway');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  // Do not let this timer be the reason the process stays alive.
  timer.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();

  clearTimeout(timer);
  logger.info('shutdown complete');
  process.exit(0);
}

/** Platforms send SIGKILL soon after SIGTERM; finish well before that. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => void shutdown(signal));
}

// A rejection nobody handled has left state unknown. Log it loudly and let the
// platform restart us rather than limping on.
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'unhandled rejection');
  void shutdown('unhandledRejection');
});
