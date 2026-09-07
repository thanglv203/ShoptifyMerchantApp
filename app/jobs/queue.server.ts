
import { logger } from "../lib/logger.server";
import { runSyncJob } from "../services/product-sync.service";

export type JobPayloads = {
  "sync-products": { jobId: string };
};

export type JobName = keyof JobPayloads;

export interface JobQueue {
  enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void>;
}

const handlers: { [N in JobName]: (payload: JobPayloads[N]) => Promise<void> } = {
  "sync-products": (payload) => runSyncJob(payload.jobId),
};

class InProcessQueue implements JobQueue {
  async enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void> {
    logger.info({ job: name, payload }, "job enqueued (in-process)");
    // setImmediate: trả action về NGAY (không giữ request), job chạy ở tick sau.
    setImmediate(() => {
      handlers[name](payload).catch((err) => {
        // Handler đã tự bọc lỗi (runSyncJob không throw); đây là lưới an toàn cuối.
        logger.error({ job: name, err: String(err) }, "job handler crashed");
      });
    });
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __jobQueue: JobQueue | undefined;
}

export const jobQueue: JobQueue =
  globalThis.__jobQueue ?? (globalThis.__jobQueue = new InProcessQueue());
