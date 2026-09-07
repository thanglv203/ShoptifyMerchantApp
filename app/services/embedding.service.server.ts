import { getEnv } from "../lib/env.server";
import {
  errorMessage,
  isPermanentError,
  isTransientError,
  TransientError,
} from "../lib/errors";
import { createEmbeddingDataHash } from "../lib/hash.server";
import { logger } from "../lib/logger.server";
import {
  embeddingRepository,
  type EmbeddingRepository,
} from "../repositories/embedding.repository";
import {
  validateEmbeddingVector,
  type EmbeddingProvider,
} from "../providers/embedding-provider";
import { createEmbeddingProvider } from "../providers/embedding-provider.factory.server";
import { buildEmbeddingText } from "./embedding-text";

export type EmbedProductResult =
  | { outcome: "embedded"; productId: string; dataHash: string }
  | {
      outcome: "skipped";
      productId: string;
      reason: "HASH_UNCHANGED" | "PRODUCT_NOT_FOUND";
    };

export type EmbedShopResult = {
  embedded: number;
  skipped: number;
  failed: number;
};

export class EmbeddingService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly repository: EmbeddingRepository,
    private readonly options: {
      version: number;
      batchSize: number;
      concurrency: number;
    },
  ) {}

  async embedProduct(
    productId: string,
    jobId?: string,
  ): Promise<EmbedProductResult> {
    const product = await this.repository.getProductForEmbedding(productId);
    if (!product) {
      logger.info({ jobId, productId }, "embedding skipped: PRODUCT_NOT_FOUND");
      return { outcome: "skipped", productId, reason: "PRODUCT_NOT_FOUND" };
    }

    const text = buildEmbeddingText(product);
    const dataHash = createEmbeddingDataHash({
      provider: this.provider.provider,
      model: this.provider.model,
      dimension: this.provider.dimension,
      version: this.options.version,
      text,
    });
    const current = await this.repository.getEmbeddingMetadata(productId);
    if (
      current?.status === "READY" &&
      current.model === this.provider.model &&
      current.dimension === this.provider.dimension &&
      current.version === this.options.version &&
      current.dataHash === dataHash
    ) {
      logger.info(
        { jobId, shopId: product.shopId, productId, dataHash },
        "embedding skipped: HASH_UNCHANGED",
      );
      return { outcome: "skipped", productId, reason: "HASH_UNCHANGED" };
    }

    await this.repository.markEmbeddingPending({
      productId,
      model: this.provider.model,
      dimension: this.provider.dimension,
      version: this.options.version,
      dataHash,
    });

    try {
      const vector = validateEmbeddingVector(
        await this.provider.embed(text, "RETRIEVAL_DOCUMENT"),
        this.provider.dimension,
      );
      await this.repository.saveEmbeddingReady({ productId, vector });
      logger.info(
        { jobId, shopId: product.shopId, productId, dataHash },
        "embedding READY",
      );
      return { outcome: "embedded", productId, dataHash };
    } catch (error) {
      const message = errorMessage(error);
      try {
        await this.repository.markEmbeddingFailed(productId, message);
      } catch (statusError) {
        logger.error(
          { jobId, productId, err: errorMessage(statusError) },
          "không ghi được trạng thái embedding FAILED",
        );
      }
      logger.error(
        {
          jobId,
          shopId: product.shopId,
          productId,
          errorKind: isPermanentError(error) ? "permanent" : "transient",
          err: message,
        },
        "embedding FAILED",
      );
      throw error;
    }
  }

  async embedShop(shopId: string, jobId?: string): Promise<EmbedShopResult> {
    const totals: EmbedShopResult = { embedded: 0, skipped: 0, failed: 0 };
    let cursor: string | null = null;
    let batch = 0;

    do {
      const page = await this.repository.listProductIdsForEmbeddingBatch(
        shopId,
        {
          cursor,
          limit: this.options.batchSize,
        },
      );
      if (page.productIds.length === 0) break;
      batch += 1;
      let firstTransient: unknown;

      for (
        let offset = 0;
        offset < page.productIds.length;
        offset += this.options.concurrency
      ) {
        const chunk = page.productIds.slice(
          offset,
          offset + this.options.concurrency,
        );
        const results = await Promise.allSettled(
          chunk.map((productId) => this.embedProduct(productId, jobId)),
        );
        for (const result of results) {
          if (result.status === "fulfilled") {
            if (result.value.outcome === "embedded") totals.embedded += 1;
            else totals.skipped += 1;
          } else {
            totals.failed += 1;
            if (isTransientError(result.reason) && !firstTransient)
              firstTransient = result.reason;
          }
        }
      }

      logger.info(
        { jobId, shopId, batch, items: page.productIds.length, ...totals },
        "embedding batch done",
      );
      if (firstTransient) throw firstTransient;
      cursor = page.nextCursor;
    } while (cursor);

    return totals;
  }
}

export function createEmbeddingService(): EmbeddingService {
  const env = getEnv();
  return new EmbeddingService(
    createEmbeddingProvider(env),
    embeddingRepository,
    {
      version: env.EMBEDDING_VERSION,
      batchSize: env.EMBEDDING_BATCH_SIZE,
      concurrency: env.EMBEDDING_CONCURRENCY,
    },
  );
}

export function shouldRetryEmbeddingError(error: unknown): boolean {
  if (isPermanentError(error)) return false;
  return (
    isTransientError(error) ||
    error instanceof TransientError ||
    error instanceof Error
  );
}
