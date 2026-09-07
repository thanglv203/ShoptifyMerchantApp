/**
 * ProductSyncService — orchestrate toàn bộ một lần sync:
 *
 *   FETCH (cursor pagination) → MAP → UPSERT (idempotent) → CHECKPOINT → ... → COMPLETED
 *
 * Chạy NGOÀI request (background job) → action chỉ tạo job + enqueue rồi trả về ngay.
 *
 * Cost của trang: mỗi OBJECT trong response = 1 điểm, connection
 * cộng thêm theo `first`. Query bên dưới với pageSize 25 + variants(first: 20)
 * 
 * requested cost ≈ 700–800 điểm — dưới trần 1.000 điểm/query. 
 * 
 * KHÔNG lấy
 * `selectedOptions` (mỗi option là 1 object × 20 variants × 25 products sẽ vượt trần);
 * variant.title đã chứa option values ("Đen / M").
 */
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getEnv } from "../lib/env.server";
import { logger } from "../lib/logger.server";
import { errorMessage } from "../lib/errors";
import { ShopifyClient } from "../providers/shopify-api.server";
import { mapProductNode, type ShopifyProductNode } from "./product-mapper";
import { upsertProductFromShopify } from "../repositories/product.repository";
import { markShopSynced } from "../repositories/shop.repository";
import {
  checkpointSyncJob,
  completeSyncJob,
  failSyncJob,
  getSyncJobRecord,
  markSyncJobRunning,
  setSyncJobTotal,
} from "../repositories/sync-job.repository";

export const PRODUCTS_COUNT_QUERY = /* GraphQL */ `
  query ProductsCount {
    productsCount {
      count
    }
  }
`;

export const PRODUCTS_PAGE_QUERY = /* GraphQL */ `
  query SyncProductsPage($pageSize: Int!, $cursor: String) {
    products(first: $pageSize, after: $cursor, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        legacyResourceId
        title
        descriptionHtml
        vendor
        productType
        tags
        status
        handle
        createdAt
        updatedAt
        featuredMedia {
          preview {
            image {
              url
              altText
            }
          }
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        variants(first: 20) {
          pageInfo {
            hasNextPage
          }
          nodes {
            id
            legacyResourceId
            title
            sku
            price
            compareAtPrice
            inventoryQuantity
            position
          }
        }
      }
    }
  }
`;

type ProductsPageData = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

type ProductsCountData = { productsCount: { count: number } | null };

/**
 * Chạy một SyncJob theo jobId. KHÔNG throw — mọi kết quả nằm trong bảng SyncJob.
 */
export async function runSyncJob(jobId: string): Promise<void> {
  const log = logger.child({ module: "product-sync", jobId });

  const job = await getSyncJobRecord(jobId);
  if (!job) {
    log.error("SyncJob không tồn tại");
    return;
  }
  const shop = await prisma.shop.findUnique({ where: { id: job.shopId } });
  if (!shop) {
    await failSyncJob(jobId, "Shop không tồn tại trong DB");
    return;
  }
  const shopLog = log.child({ shop: shop.domain });

  try {
    await markSyncJobRunning(jobId);

    // Admin client cho background: offline token từ bảng Session.
    const { admin } = await unauthenticated.admin(shop.domain);
    const client = new ShopifyClient(
      (query, options) => admin.graphql(query, options),
      shopLog,
    );

    // Tổng số product (hiển thị tiến độ) — chỉ khi bắt đầu từ đầu, resume giữ nguyên.
    if (job.processedCount === 0) {
      const { data } = await client.request<ProductsCountData>(PRODUCTS_COUNT_QUERY);
      const total = data.productsCount?.count;
      if (typeof total === "number") await setSyncJobTotal(jobId, total);
      shopLog.info({ total }, "bắt đầu full sync");
    } else {
      shopLog.info(
        { processed: job.processedCount, cursor: job.cursor },
        "resume sync từ checkpoint",
      );
    }

    const pageSize = getEnv().SYNC_PAGE_SIZE;
    let cursor: string | null = job.cursor;
    let hasNextPage = true;
    let page = 0;

    while (hasNextPage) {
      const { data, cost } = await client.request<ProductsPageData>(
        PRODUCTS_PAGE_QUERY,
        { pageSize, cursor },
      );
      const { nodes, pageInfo } = data.products;
      page += 1;

      let created = 0;
      let updated = 0;
      let skipped = 0;
      for (const node of nodes) {
        const input = mapProductNode(node);
        if (input.variantsTruncated) {
          shopLog.warn(
            { product: input.gid },
            "product có > 20 variants — chỉ sync 20 đầu (đầy đủ cần Bulk Operations)",
          );
        }
        const result = await upsertProductFromShopify(job.shopId, input);
        if (result === "created") created += 1;
        else if (result === "updated") updated += 1;
        else skipped += 1;
      }

      cursor = pageInfo.endCursor;
      hasNextPage = pageInfo.hasNextPage;

      // CHECKPOINT: commit cursor + tiến độ NGAY sau mỗi trang → crash là resume được.
      await checkpointSyncJob(jobId, { cursor, processed: nodes.length });

      shopLog.info(
        {
          page,
          items: nodes.length,
          created,
          updated,
          skipped,
          actualCost: cost?.actualQueryCost ?? null,
          bucketAvailable: cost?.throttleStatus.currentlyAvailable ?? null,
        },
        "sync page done",
      );

      if (nodes.length === 0) break; // phòng thủ: trang rỗng nhưng hasNextPage true
    }

    await markShopSynced(job.shopId);
    await completeSyncJob(jobId);
    shopLog.info("sync COMPLETED");
  } catch (err) {
    const message = errorMessage(err);
    shopLog.error({ err: message }, "sync FAILED — cursor đã checkpoint, có thể Resume");
    try {
      await failSyncJob(jobId, message);
    } catch (updateErr) {
      shopLog.error({ err: errorMessage(updateErr) }, "không ghi được trạng thái FAILED");
    }
  }
}
