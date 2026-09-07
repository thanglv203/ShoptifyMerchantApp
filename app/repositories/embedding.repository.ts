import prisma from "../db.server";

export type EmbeddingProductRecord = {
  id: string;
  shopId: string;
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  price: string | null;
  currencyCode: string | null;
  variants: Array<{
    shopifyId: string;
    title: string;
    sku: string | null;
    price: string;
    compareAtPrice: string | null;
    position: number | null;
  }>;
};

export type EmbeddingMetadata = {
  model: string;
  dimension: number;
  version: number;
  dataHash: string;
  status: "PENDING" | "READY" | "FAILED";
};

export async function getProductForEmbedding(
  productId: string,
): Promise<EmbeddingProductRecord | null> {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { variants: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
  });
  if (!product) return null;
  return {
    id: product.id,
    shopId: product.shopId,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    price: product.price?.toString() ?? null,
    currencyCode: product.currencyCode,
    variants: product.variants.map((variant) => ({
      shopifyId: variant.shopifyId.toString(),
      title: variant.title,
      sku: variant.sku,
      price: variant.price.toString(),
      compareAtPrice: variant.compareAtPrice?.toString() ?? null,
      position: variant.position,
    })),
  };
}

export async function listProductIdsForEmbeddingBatch(
  shopId: string,
  args: { cursor?: string | null; limit: number },
): Promise<{ productIds: string[]; nextCursor: string | null }> {
  const products = await prisma.product.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { id: "asc" },
    take: args.limit,
    ...(args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {}),
    select: { id: true },
  });
  return {
    productIds: products.map((product) => product.id),
    nextCursor:
      products.length === args.limit
        ? (products[products.length - 1]?.id ?? null)
        : null,
  };
}

export async function getEmbeddingMetadata(
  productId: string,
): Promise<EmbeddingMetadata | null> {
  const row = await prisma.productEmbedding.findUnique({
    where: { productId },
    select: {
      model: true,
      dimension: true,
      version: true,
      dataHash: true,
      status: true,
    },
  });
  return row;
}

export async function markEmbeddingPending(input: {
  productId: string;
  model: string;
  dimension: number;
  version: number;
  dataHash: string;
}): Promise<void> {
  await prisma.productEmbedding.upsert({
    where: { productId: input.productId },
    create: { ...input, status: "PENDING" },
    update: {
      model: input.model,
      dimension: input.dimension,
      version: input.version,
      dataHash: input.dataHash,
      status: "PENDING",
      error: null,
      embeddedAt: null,
    },
  });
}

export async function saveEmbeddingReady(input: {
  productId: string;
  vector: number[];
}): Promise<void> {
  const vectorLiteral = `[${input.vector.join(",")}]`;
  await prisma.$executeRaw`
    UPDATE "ProductEmbedding"
    SET "embedding" = ${vectorLiteral}::vector,
        "status" = 'READY'::"EmbeddingStatus",
        "error" = NULL,
        "embeddedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE "productId" = ${input.productId}
  `;
}

export async function markEmbeddingFailed(
  productId: string,
  message: string,
): Promise<void> {
  await prisma.productEmbedding.updateMany({
    where: { productId },
    data: { status: "FAILED", error: message.slice(0, 2000), embeddedAt: null },
  });
}

export const embeddingRepository = {
  getProductForEmbedding,
  listProductIdsForEmbeddingBatch,
  getEmbeddingMetadata,
  markEmbeddingPending,
  saveEmbeddingReady,
  markEmbeddingFailed,
};

export type EmbeddingRepository = typeof embeddingRepository;
