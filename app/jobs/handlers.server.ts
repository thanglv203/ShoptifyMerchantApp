import { errorMessage, isPermanentError } from "../lib/errors";
import { logger } from "../lib/logger.server";
import { runSyncJob } from "../services/product-sync.service";
import { createEmbeddingService } from "../services/embedding.service.server";
import type { JobPayloads } from "./job-types";

export async function handleSyncProductsJob(
  payload: JobPayloads["sync-products"],
): Promise<{ shopId: string } | null> {
  return runSyncJob(payload.jobId);
}

export async function handleEmbedProductJob(
  payload: JobPayloads["embed-product"],
  pgBossJobId: string,
): Promise<void> {
  try {
    await createEmbeddingService().embedProduct(payload.productId, pgBossJobId);
  } catch (error) {
    if (isPermanentError(error)) {
      logger.warn(
        {
          jobId: pgBossJobId,
          shopId: payload.shopId,
          productId: payload.productId,
          err: errorMessage(error),
        },
        "embedding permanent error — không retry",
      );
      return;
    }
    logger.error(
      {
        jobId: pgBossJobId,
        shopId: payload.shopId,
        productId: payload.productId,
        err: errorMessage(error),
      },
      "embedding transient error — pg-boss sẽ retry",
    );
    throw error;
  }
}

export async function handleEmbedShopJob(
  payload: JobPayloads["embed-shop"],
  pgBossJobId: string,
): Promise<void> {
  try {
    await createEmbeddingService().embedShop(payload.shopId, pgBossJobId);
  } catch (error) {
    if (isPermanentError(error)) {
      logger.warn(
        {
          jobId: pgBossJobId,
          shopId: payload.shopId,
          err: errorMessage(error),
        },
        "embed-shop permanent error — không retry",
      );
      return;
    }
    logger.error(
      { jobId: pgBossJobId, shopId: payload.shopId, err: errorMessage(error) },
      "embed-shop transient error — pg-boss sẽ retry",
    );
    throw error;
  }
}
