import { errorMessage, isPermanentError } from "../lib/errors";
import { logger } from "../lib/logger.server";
import {
  softDeleteProductByShopifyId,
  upsertProductFromShopify,
} from "../repositories/product.repository";
import { getOrCreateShop } from "../repositories/shop.repository";
import {
  claimWebhookEvent,
  completeWebhookEvent,
  failWebhookEvent,
  skipWebhookEvent,
} from "../repositories/webhook-event.repository";
import {
  mapProductWebhookPayload,
  normalizeProductWebhookTopic,
  productIdFromDeletePayload,
  webhookResourceMetadata,
} from "./webhook-product.mapper";

export type HandleProductWebhookInput = {
  webhookId: string;
  eventId?: string | null;
  topic: string;
  shopDomain: string;
  payload: unknown;
};

export type HandleProductWebhookResult = {
  outcome: "processed" | "skipped" | "duplicate" | "failed";
  retry: boolean;
};

/**
 * Một đường xử lý chung cho products/create|update|delete.
 * Route đã verify HMAC; service chịu trách nhiệm dedupe, upsert/delete và audit trạng thái.
 */
export async function handleProductWebhook(
  input: HandleProductWebhookInput,
): Promise<HandleProductWebhookResult> {
  const log = logger.child({
    module: "product-webhook",
    webhookId: input.webhookId,
    shop: input.shopDomain,
    topic: input.topic,
  });
  const metadata = webhookResourceMetadata(input.payload);
  const claim = await claimWebhookEvent({
    webhookId: input.webhookId,
    eventId: input.eventId,
    shopDomain: input.shopDomain,
    topic: input.topic,
    ...metadata,
  });

  if (!claim.claimed) {
    log.info({ existingStatus: claim.status }, "webhook duplicate — bỏ qua");
    return { outcome: "duplicate", retry: false };
  }

  try {
    const topic = normalizeProductWebhookTopic(input.topic);
    if (!topic) {
      const reason = `Topic không được hỗ trợ: ${input.topic}`;
      await skipWebhookEvent(claim.eventId, reason);
      log.warn(reason);
      return { outcome: "skipped", retry: false };
    }

    const shop = await getOrCreateShop(input.shopDomain);

    if (topic === "PRODUCTS_DELETE") {
      const productId = productIdFromDeletePayload(input.payload);
      const deleted = await softDeleteProductByShopifyId(
        shop.id,
        BigInt(productId),
      );
      await completeWebhookEvent(claim.eventId, {
        shopId: shop.id,
        skipped: deleted === 0,
      });
      log.info({ productId, deleted }, "products/delete đã xử lý");
      return { outcome: deleted === 0 ? "skipped" : "processed", retry: false };
    }

    const product = mapProductWebhookPayload(input.payload);
    const result = await upsertProductFromShopify(shop.id, product);
    await completeWebhookEvent(claim.eventId, {
      shopId: shop.id,
      skipped: result === "skipped",
    });
    log.info(
      { productId: product.shopifyId, result },
      `${topic.toLowerCase()} đã xử lý`,
    );
    return {
      outcome: result === "skipped" ? "skipped" : "processed",
      retry: false,
    };
  } catch (error) {
    const message = errorMessage(error);
    try {
      if (isPermanentError(error)) {
        await skipWebhookEvent(claim.eventId, message);
        log.warn(
          { err: message },
          "webhook payload không hợp lệ — không retry",
        );
        return { outcome: "skipped", retry: false };
      }
      await failWebhookEvent(claim.eventId, message);
    } catch (auditError) {
      log.error(
        { err: errorMessage(auditError) },
        "không cập nhật được WebhookEvent",
      );
    }
    log.error(
      { err: message },
      "xử lý webhook thất bại — yêu cầu Shopify retry",
    );
    return { outcome: "failed", retry: true };
  }
}
