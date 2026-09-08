import pino from "pino";
import { PgBoss } from "pg-boss";
import { z } from "zod";
const level = process.env.LOG_LEVEL ?? "info";
const isProd = process.env.NODE_ENV === "production";
const logger = pino({
  level,
  redact: {
    paths: [
      "accessToken",
      "*.accessToken",
      "refreshToken",
      "*.refreshToken",
      "apiSecret",
      "*.apiSecret",
      "SHOPIFY_API_SECRET",
      "req.headers.authorization",
      "headers['x-shopify-access-token']"
    ],
    censor: "[REDACTED]"
  },
  ...isProd ? {} : {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" }
    }
  }
});
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SHOPIFY_API_KEY: z.string().min(1, "SHOPIFY_API_KEY (client id) is required"),
  SHOPIFY_API_SECRET: z.string().min(1, "SHOPIFY_API_SECRET (client secret) is required"),
  SHOPIFY_APP_URL: z.string().min(1, "SHOPIFY_APP_URL is required"),
  SCOPES: z.string().default("read_products"),
  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((v) => v.startsWith("postgres"), {
    message: "DATABASE_URL must be a PostgreSQL connection string"
  }),
  // App
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(250).default(25),
  // Embedding — vector 768 chiều.
  EMBEDDING_PROVIDER: z.enum(["fake", "gemini", "ollama"]).default("fake"),
  EMBEDDING_DIMENSION: z.coerce.number().int().refine((value) => value === 768, "EMBEDDING_DIMENSION must be 768").default(768),
  EMBEDDING_VERSION: z.coerce.number().int().min(1).default(1),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(50),
  EMBEDDING_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(5),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  OLLAMA_BASE_URL: z.string().url().default("http://localhost:11434"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("bge-m3"),
  EVAL_SHOP_DOMAIN: z.string().optional()
});
function parseEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`
    );
    throw new Error(
      `
${lines.join("\n")}
`
    );
  }
  return result.data;
}
let cached;
function getEnv() {
  if (!cached) cached = parseEnv();
  return cached;
}
class TransientError extends Error {
  kind = "transient";
  constructor(message, options) {
    super(message, options);
    this.name = "TransientError";
  }
}
class PermanentError extends Error {
  kind = "permanent";
  constructor(message, options) {
    super(message, options);
    this.name = "PermanentError";
  }
}
function isTransientError(err) {
  return err instanceof TransientError;
}
function isPermanentError(err) {
  return err instanceof PermanentError;
}
function errorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}
function jobSingletonKey(name, payload) {
  if (name === "sync-products")
    return payload.jobId;
  if (name === "embed-product")
    return payload.productId;
  return payload.shopId;
}
class PgBossQueue {
  boss;
  startPromise;
  workerPromise;
  start() {
    if (!this.startPromise) {
      this.startPromise = this.initializePublisher().catch((error) => {
        this.startPromise = void 0;
        throw error;
      });
    }
    return this.startPromise;
  }
  async initializePublisher() {
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
        heartbeatSeconds: 60
      });
      await boss.createQueue("embed-product", {
        policy: "key_strict_fifo",
        retryLimit: 5,
        retryDelay: 5,
        retryBackoff: true,
        heartbeatSeconds: 60
      });
      await boss.createQueue("embed-shop", {
        policy: "exclusive",
        retryLimit: 5,
        retryDelay: 10,
        retryBackoff: true,
        heartbeatSeconds: 60
      });
      logger.info("pg-boss publisher started");
    } catch (error) {
      this.boss = void 0;
      throw new TransientError("Không khởi động được pg-boss publisher", {
        cause: error
      });
    }
  }
  startWorker() {
    if (!this.workerPromise) {
      this.workerPromise = this.initializeWorker().catch((error) => {
        this.workerPromise = void 0;
        throw error;
      });
    }
    return this.workerPromise;
  }
  async initializeWorker() {
    await this.start();
    const boss = this.boss;
    const handlers = await import("./assets/handlers.server-DNsJUWoC.js");
    await boss.work("sync-products", async ([job]) => {
      try {
        const completed = await handlers.handleSyncProductsJob(
          job.data
        );
        if (completed) await this.enqueue("embed-shop", completed);
      } catch (error) {
        logger.error(
          { jobId: job.id, err: errorMessage(error) },
          "sync-products handler crashed"
        );
        throw error;
      }
    });
    await boss.work("embed-product", async ([job]) => {
      await handlers.handleEmbedProductJob(
        job.data,
        job.id
      );
    });
    await boss.work("embed-shop", async ([job]) => {
      await handlers.handleEmbedShopJob(
        job.data,
        job.id
      );
    });
    logger.info(
      "pg-boss worker started: sync-products, embed-product, embed-shop"
    );
  }
  async stop() {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = void 0;
    this.startPromise = void 0;
    this.workerPromise = void 0;
    await boss.stop();
    logger.info("pg-boss stopped");
  }
  async enqueue(name, payload) {
    await this.start();
    try {
      const id = await this.boss.send(name, payload, {
        singletonKey: jobSingletonKey(name, payload)
      });
      logger.info(
        { job: name, jobId: id, singletonKey: jobSingletonKey(name, payload) },
        id ? "job enqueued (pg-boss)" : "job deduplicated (pg-boss)"
      );
    } catch (error) {
      throw new TransientError(`Không enqueue được job ${name}`, {
        cause: error
      });
    }
  }
}
const jobQueue = globalThis.__jobQueue ?? (globalThis.__jobQueue = new PgBossQueue());
let shuttingDown = false;
async function shutdown(signal) {
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
export {
  PermanentError as P,
  TransientError as T,
  isTransientError as a,
  errorMessage as e,
  getEnv as g,
  isPermanentError as i,
  logger as l
};
//# sourceMappingURL=start-worker.js.map
