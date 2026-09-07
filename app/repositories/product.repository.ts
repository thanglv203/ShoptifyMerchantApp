
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";



export type ProductListItem = {
  id: string;
  shopifyId: string; // BigInt → string
  gid: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string;
  price: string | null; // Decimal → string
  currencyCode: string | null;
  imageUrl: string | null;
  variantCount: number;
  shopifyUpdatedAt: string | null; // ISO
  syncedAt: string; // ISO
  deletedAt: string | null;
};

export type ProductListResult = {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

type ProductRow = Prisma.ProductGetPayload<{
  include: { _count: { select: { variants: true } } };
}>;

function toListItem(p: ProductRow): ProductListItem {
  return {
    id: p.id,
    shopifyId: p.shopifyId.toString(),
    gid: p.gid,
    title: p.title,
    vendor: p.vendor,
    productType: p.productType,
    tags: p.tags,
    status: p.status,
    price: p.price ? p.price.toString() : null,
    currencyCode: p.currencyCode,
    imageUrl: p.imageUrl,
    variantCount: p._count.variants,
    shopifyUpdatedAt: p.shopifyUpdatedAt
      ? p.shopifyUpdatedAt.toISOString()
      : null,
    syncedAt: p.syncedAt.toISOString(),
    deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null,
  };
}

/** Phân trang offset đơn giản cho UI (khác cursor pagination của Shopify API). */
export async function listProducts(
  shopId: string,
  opts: { page?: number; pageSize?: number; includeDeleted?: boolean } = {},
): Promise<ProductListResult> {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const where: Prisma.ProductWhereInput = {
    shopId,
    ...(opts.includeDeleted ? {} : { deletedAt: null }),
  };

  const total = await prisma.product.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(opts.page ?? 1, 1), pageCount);

  const rows = await prisma.product.findMany({
    where,
    orderBy: [{ shopifyUpdatedAt: "desc" }, { id: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    include: { _count: { select: { variants: true } } },
  });

  return { items: rows.map(toListItem), total, page, pageSize, pageCount };
}

export type ProductStats = {
  active: number;
  deleted: number;
  lastSyncedAt: string | null; // product mới nhất được sync
};

export async function getProductStats(shopId: string): Promise<ProductStats> {
  const [active, deleted, latest] = await Promise.all([
    prisma.product.count({ where: { shopId, deletedAt: null } }),
    prisma.product.count({ where: { shopId, deletedAt: { not: null } } }),
    prisma.product.findFirst({
      where: { shopId },
      orderBy: { syncedAt: "desc" },
      select: { syncedAt: true },
    }),
  ]);
  return {
    active,
    deleted,
    lastSyncedAt: latest ? latest.syncedAt.toISOString() : null,
  };
}


export type UpsertVariantInput = {
  shopifyId: string; // BigInt → string
  gid: string;
  title: string;
  sku: string | null;
  price: string; // Decimal nhận string
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  position: number | null;
};

export type UpsertProductInput = {
  shopifyId: string;
  gid: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  status: string;
  handle: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: string | null;
  currencyCode: string | null;
  shopifyCreatedAt: string | null; // ISO
  shopifyUpdatedAt: string | null; // ISO
  variants: UpsertVariantInput[];
  variantsTruncated: boolean;
};

export type UpsertAction = "created" | "updated" | "skipped";
export type UpsertResult = { action: UpsertAction; productId: string };

/**
 * Guard chống ghi đè bằng dữ liệu CŨ HƠN (webhook lệch thứ tự / retry chậm /
 * sync ghi đè bản mới hơn mà webhook vừa cập nhật).
 * Chỉ skip khi bản trong DB MỚI HƠN HẲN bản đến; bằng nhau vẫn ghi (idempotent).
 * Pure function — export để unit test.
 */
export function shouldSkipUpdate(
  existingShopifyUpdatedAt: Date | null,
  incomingShopifyUpdatedAt: Date | null,
): boolean {
  if (!existingShopifyUpdatedAt || !incomingShopifyUpdatedAt) return false;
  return (
    existingShopifyUpdatedAt.getTime() > incomingShopifyUpdatedAt.getTime()
  );
}

/**
 * Upsert product + thay toàn bộ variants trong MỘT transaction.
 * - Idempotent theo (shopId, shopifyId): ghi lại bản cũ → update; ghi bản mới → update; ghi bản cũ hơn → skip.
 * - deletedAt = null khi ghi: product vừa được sync/webhook → coi là "active" (khác với soft delete).
 * - Variants: deleteMany + createMany — không update từng variant (shopifyId) vì Shopify có thể xoá/đổi variant.
 * - Không throw lỗi khi product bị skip (bản trong DB mới hơn bản đến) — caller tự quyết định log/ignore.
 * - Không throw lỗi khi product không tìm thấy để xoá (webhook products/delete) — caller tự quyết định log/ignore.
 */
export async function upsertProductFromShopify(
  shopId: string,
  input: UpsertProductInput,
): Promise<UpsertResult> {
  const shopifyId = BigInt(input.shopifyId);
  const incomingUpdatedAt = input.shopifyUpdatedAt
    ? new Date(input.shopifyUpdatedAt)
    : null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { shopId_shopifyId: { shopId, shopifyId } },
      select: { id: true, shopifyUpdatedAt: true },
    });

    if (
      existing &&
      shouldSkipUpdate(existing.shopifyUpdatedAt, incomingUpdatedAt)
    ) {
      return { action: "skipped", productId: existing.id };
    }

    const data = {
      gid: input.gid,
      title: input.title,
      descriptionHtml: input.descriptionHtml,
      vendor: input.vendor,
      productType: input.productType,
      tags: input.tags,
      status: input.status,
      handle: input.handle,
      imageUrl: input.imageUrl,
      imageAlt: input.imageAlt,
      price: input.price, // Prisma Decimal nhận string
      currencyCode: input.currencyCode,
      shopifyCreatedAt: input.shopifyCreatedAt
        ? new Date(input.shopifyCreatedAt)
        : null,
      shopifyUpdatedAt: incomingUpdatedAt,
      syncedAt: new Date(),
      deletedAt: null,
    };

    const product = existing
      ? await tx.product.update({ where: { id: existing.id }, data })
      : await tx.product.create({ data: { ...data, shopId, shopifyId } });

    await tx.variant.deleteMany({ where: { productId: product.id } });
    if (input.variants.length > 0) {
      await tx.variant.createMany({
        data: input.variants.map((v) => ({
          productId: product.id,
          shopifyId: BigInt(v.shopifyId),
          gid: v.gid,
          title: v.title,
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          inventoryQuantity: v.inventoryQuantity,
          position: v.position,
        })),
      });
    }

    return {
      action: existing ? "updated" : "created",
      productId: product.id,
    };
  });
}


export async function softDeleteProductByShopifyId(
  shopId: string,
  shopifyId: bigint,
): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const product = await tx.product.findUnique({
      where: { shopId_shopifyId: { shopId, shopifyId } },
      select: { id: true },
    });
    if (!product) return 0;

    const deleted = await tx.product.updateMany({
      where: { id: product.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (deleted.count === 0) return 0;

    await tx.productEmbedding.deleteMany({ where: { productId: product.id } });
    return deleted.count;
  });
}