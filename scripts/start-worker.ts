import { logger } from "../app/lib/logger.server";
import { jobQueue } from "../app/jobs/queue.server";

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "worker shutting down");
  try {
    await jobQueue.stop();
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "worker shutdown failed");
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await jobQueue.startWorker();
  logger.info("background worker ready");
} catch (error) {
  logger.fatal({ err: error }, "background worker failed to start");
  process.exit(1);
}
