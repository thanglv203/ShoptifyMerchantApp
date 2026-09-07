
import type {
  UpsertProductInput,
  UpsertVariantInput,
} from "../repositories/product.repository";


export type ShopifyVariantNode = {
  id: string;
  legacyResourceId: string;
  title?: string | null;
  sku?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  inventoryQuantity?: number | null;
  position?: number | null;
};

export type ShopifyProductNode = {
  id: string;
  legacyResourceId: string;
  title: string;
  descriptionHtml?: string | null;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  status?: string | null;
  handle?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  featuredMedia?: {
    preview?: { image?: { url?: string | null; altText?: string | null } | null } | null;
  } | null;
  priceRangeV2?: {
    minVariantPrice?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
  variants?: {
    pageInfo?: { hasNextPage?: boolean | null } | null;
    nodes?: ShopifyVariantNode[] | null;
  } | null;
};

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function mapVariant(v: ShopifyVariantNode): UpsertVariantInput {
  return {
    shopifyId: v.legacyResourceId,
    gid: v.id,
    title: emptyToNull(v.title) ?? "Default Title",
    sku: emptyToNull(v.sku),
    price: emptyToNull(v.price) ?? "0",
    compareAtPrice: emptyToNull(v.compareAtPrice),
    inventoryQuantity: v.inventoryQuantity ?? null,
    position: v.position ?? null,
  };
}

export function mapProductNode(node: ShopifyProductNode): UpsertProductInput {
  const image = node.featuredMedia?.preview?.image ?? null;
  const minPrice = node.priceRangeV2?.minVariantPrice ?? null;
  const variants = (node.variants?.nodes ?? []).map(mapVariant);

  return {
    shopifyId: node.legacyResourceId,
    gid: node.id,
    title: emptyToNull(node.title) ?? "(untitled)",
    descriptionHtml: emptyToNull(node.descriptionHtml),
    vendor: emptyToNull(node.vendor),
    productType: emptyToNull(node.productType),
    tags: (node.tags ?? []).map((t) => t.trim()).filter((t) => t.length > 0),
    status: emptyToNull(node.status) ?? "ACTIVE",
    handle: emptyToNull(node.handle),
    imageUrl: emptyToNull(image?.url),
    imageAlt: emptyToNull(image?.altText),
    price: emptyToNull(minPrice?.amount),
    currencyCode: emptyToNull(minPrice?.currencyCode),
    shopifyCreatedAt: emptyToNull(node.createdAt),
    shopifyUpdatedAt: emptyToNull(node.updatedAt),
    variants,
    variantsTruncated: node.variants?.pageInfo?.hasNextPage === true,
  };
}
