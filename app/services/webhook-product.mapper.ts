import { PermanentError } from "../lib/errors";
import type {
  UpsertProductInput,
  UpsertVariantInput,
} from "../repositories/product.repository";

export type ProductWebhookTopic =
  "PRODUCTS_CREATE" | "PRODUCTS_UPDATE" | "PRODUCTS_DELETE";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericId(value: unknown, field = "id"): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
    return String(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  throw new PermanentError(`Webhook product thiếu ${field} hợp lệ`);
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function dateText(value: unknown): string | null {
  const valueText = text(value);
  if (!valueText) return null;
  const date = new Date(valueText);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(text).filter((item): item is string => Boolean(item));
  }
  const valueText = text(value);
  return valueText
    ? valueText
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function money(value: unknown, fallback = "0"): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value) ?? fallback;
}

function mapVariant(value: JsonRecord): UpsertVariantInput {
  const shopifyId = numericId(value.id, "variant.id");
  return {
    shopifyId,
    gid:
      text(value.admin_graphql_api_id) ??
      `gid://shopify/ProductVariant/${shopifyId}`,
    title: text(value.title) ?? "Default Title",
    sku: text(value.sku),
    price: money(value.price),
    compareAtPrice: text(value.compare_at_price),
    inventoryQuantity: integer(value.inventory_quantity),
    position: integer(value.position),
  };
}

function minimumPrice(variants: UpsertVariantInput[]): string | null {
  if (variants.length === 0) return null;
  return variants.reduce(
    (minimum, variant) =>
      Number(variant.price) < Number(minimum) ? variant.price : minimum,
    variants[0].price,
  );
}

function imageData(payload: JsonRecord): {
  url: string | null;
  alt: string | null;
} {
  const candidate = isRecord(payload.image)
    ? payload.image
    : records(payload.images)[0];
  if (!candidate) return { url: null, alt: null };
  return {
    url: text(candidate.src) ?? text(candidate.url),
    alt: text(candidate.alt) ?? text(candidate.altText),
  };
}

function currencyCode(payload: JsonRecord): string | null {
  const direct = text(payload.currency) ?? text(payload.currency_code);
  if (direct) return direct;
  const firstVariant = records(payload.variants)[0];
  const firstPresentment = firstVariant
    ? records(firstVariant.presentment_prices)[0]
    : undefined;
  const price =
    firstPresentment && isRecord(firstPresentment.price)
      ? firstPresentment.price
      : undefined;
  return price ? text(price.currency_code) : null;
}

export function normalizeProductWebhookTopic(
  topic: string,
): ProductWebhookTopic | null {
  const normalized = topic.trim().toUpperCase().replaceAll("/", "_");
  if (
    normalized === "PRODUCTS_CREATE" ||
    normalized === "PRODUCTS_UPDATE" ||
    normalized === "PRODUCTS_DELETE"
  ) {
    return normalized;
  }
  return null;
}

export function webhookResourceMetadata(payload: unknown): {
  resourceId: string | null;
  shopifyUpdatedAt: string | null;
} {
  if (!isRecord(payload)) return { resourceId: null, shopifyUpdatedAt: null };
  let resourceId: string | null = null;
  try {
    resourceId = numericId(payload.id);
  } catch {
    // Handler sẽ validate đầy đủ sau khi delivery đã được ghi vào sổ cái.
  }
  return { resourceId, shopifyUpdatedAt: dateText(payload.updated_at) };
}

export function mapProductWebhookPayload(payload: unknown): UpsertProductInput {
  if (!isRecord(payload))
    throw new PermanentError("Webhook product payload không phải object");

  const shopifyId = numericId(payload.id);
  const variants = records(payload.variants).map(mapVariant);
  const image = imageData(payload);

  return {
    shopifyId,
    gid:
      text(payload.admin_graphql_api_id) ??
      `gid://shopify/Product/${shopifyId}`,
    title: text(payload.title) ?? "Untitled product",
    descriptionHtml: text(payload.body_html),
    vendor: text(payload.vendor),
    productType: text(payload.product_type),
    tags: stringArray(payload.tags),
    status: (text(payload.status) ?? "active").toUpperCase(),
    handle: text(payload.handle),
    imageUrl: image.url,
    imageAlt: image.alt,
    price: minimumPrice(variants),
    currencyCode: currencyCode(payload),
    shopifyCreatedAt: dateText(payload.created_at),
    shopifyUpdatedAt: dateText(payload.updated_at),
    variants,
    variantsTruncated: false,
  };
}

export function productIdFromDeletePayload(payload: unknown): string {
  if (!isRecord(payload))
    throw new PermanentError("Webhook delete payload không phải object");
  return numericId(payload.id);
}
