import { PgBoss } from "pg-boss";
import { getEnv } from "../lib/env.server";
import { errorMessage, TransientError } from "../lib/errors";
import { logger } from "../lib/logger.server";
import { jobSingletonKey, type JobName, type JobPayloads } from "./job-types";

export interface JobQueue {
  /** Khởi động publisher để app có thể gửi job; KHÔNG đăng ký consumer. */
  start(): Promise<void>;
  /** Chỉ gọi trong process worker độc lập. */
  startWorker(): Promise<void>;
  stop(): Promise<void>;
  enqueue<N extends JobName>(name: N, payload: JobPayloads[N]): Promise<void>;
}

class PgBossQueue implements JobQueue {
  private boss: PgBoss | undefined;
  private startPromise: Promise<void> | undefined;
  private workerPromise: Promise<void> | undefined;

  start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.initializePublisher().catch((error) => {
        this.startPromise = undefined;
        throw error;
      });
    }
    return this.startPromise;
  }

  private async initializePublisher(): Promise<void> {
    try {
      const boss = new PgBoss(getEnv().DATABASE_URL);
      this.boss = boss;
      boss.on("error", (error) => {
        logger.error({ err: errorMessage(error) }, "pg-boss background error");
      });
      await boss.start();
      await boss.createQueue("sync-products", {
        policy: "singleton",
        retryLimit: 3,
        retryDelay: 5,
        retryBackoff: true,
        heartbeatSeconds: 60,
      });
      await boss.createQueue("embed-product", {
        policy: "key_strict_fifo",
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        heartbeatSeconds: 60,
      });
      await boss.createQueue("embed-shop", {
        policy: "exclusive",
        retryLimit: 5,
        retryDelay: 10,
        retryBackoff: true,
        heartbeatSeconds: 60,
      });
      logger.info("pg-boss publisher started");
    } catch (error) {
      this.boss = undefined;
      throw new TransientError("Không khởi động được pg-boss publisher", {
        cause: error,
      });
    }
  }

  startWorker(): Promise<void> {
    if (!this.workerPromise) {
      this.workerPromise = this.initializeWorker().catch((error) => {
        this.workerPromise = undefined;
        throw error;
      });
    }
    return this.workerPromise;
  }

  private async initializeWorker(): Promise<void> {
    await this.start();
    const boss = this.boss!;
    const handlers = await import("./handlers.server");

    await boss.work("sync-products", async ([job]) => {
      try {
        const completed = await handlers.handleSyncProductsJob(
          job.data as JobPayloads["sync-products"],
        );
        if (completed) await this.enqueue("embed-shop", completed);
      } catch (error) {
        logger.error(
          { jobId: job.id, err: errorMessage(error) },
          "sync-products handler crashed",
        );
        throw error;
      }
    });
    await boss.work("embed-product", async ([job]) => {
      await handlers.handleEmbedProductJob(
        job.data as JobPayloads["embed-product"],
        job.id,
      );
    });
    await boss.work("embed-shop", async ([job]) => {
      await handlers.handleEmbedShopJob(
        job.data as JobPayloads["embed-shop"],
        job.id,
      );
    });
    logger.info(
      "pg-boss worker started: sync-products, embed-product, embed-shop",
    );
  }

  async stop(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = undefined;
    this.startPromise = undefined;
    this.workerPromise = undefined;
    await boss.stop();
    logger.info("pg-boss stopped");
  }

  async enqueue<N extends JobName>(
    name: N,
    payload: JobPayloads[N],
  ): Promise<void> {
    await this.start();
    try {
      const id = await this.boss!.send(name, payload, {
        singletonKey: jobSingletonKey(name, payload),
      });
      logger.info(
        { job: name, jobId: id, singletonKey: jobSingletonKey(name, payload) },
        id ? "job enqueued (pg-boss)" : "job deduplicated (pg-boss)",
      );
    } catch (error) {
      throw new TransientError(`Không enqueue được job ${name}`, {
        cause: error,
      });
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __jobQueue: JobQueue | undefined;
}

export const jobQueue: JobQueue =
  globalThis.__jobQueue ?? (globalThis.__jobQueue = new PgBossQueue());
