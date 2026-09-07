import { Prisma } from "@prisma/client";
import prisma from "../db.server";

export type SearchProductResult = {
  id: string;
  shopifyId: string;
  gid: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: string | null;
  currencyCode: string | null;
  similarity: number;
};

export type VectorSearchInput = {
  shopId: string;
  vector: number[];
  model: string;
  dimension: number;
  version: number;
  minPrice: number | null;
  maxPrice: number | null;
  limit?: number;
};

type SearchDatabaseRow = {
  id: string;
  shopifyId: bigint;
  gid: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  price: Prisma.Decimal | null;
  currencyCode: string | null;
  similarity: number;
};

export async function searchProductsByVector(
  input: VectorSearchInput,
): Promise<SearchProductResult[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 20);
  const vectorLiteral = `[${input.vector.join(",")}]`;
  const minFilter =
    input.minPrice === null
      ? Prisma.empty
      : Prisma.sql`AND p."price" >= ${String(input.minPrice)}::numeric`;
  const maxFilter =
    input.maxPrice === null
      ? Prisma.empty
      : Prisma.sql`AND p."price" <= ${String(input.maxPrice)}::numeric`;

  const rows = await prisma.$queryRaw<SearchDatabaseRow[]>(Prisma.sql`
    SELECT
      p."id",
      p."shopifyId",
      p."gid",
      p."title",
      p."vendor",
      p."productType",
      p."imageUrl",
      p."imageAlt",
      p."price",
      p."currencyCode",
      (1 - (pe."embedding" <=> ${vectorLiteral}::vector))::float8 AS "similarity"
    FROM "Product" p
    INNER JOIN "ProductEmbedding" pe ON pe."productId" = p."id"
    WHERE p."shopId" = ${input.shopId}
      AND p."deletedAt" IS NULL
      AND pe."status" = 'READY'::"EmbeddingStatus"
      AND pe."embedding" IS NOT NULL
      AND pe."model" = ${input.model}
      AND pe."dimension" = ${input.dimension}
      AND pe."version" = ${input.version}
      ${minFilter}
      ${maxFilter}
    ORDER BY pe."embedding" <=> ${vectorLiteral}::vector ASC, p."id" ASC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    shopifyId: row.shopifyId.toString(),
    gid: row.gid,
    title: row.title,
    vendor: row.vendor,
    productType: row.productType,
    imageUrl: row.imageUrl,
    imageAlt: row.imageAlt,
    price: row.price?.toString() ?? null,
    currencyCode: row.currencyCode,
    similarity: Number(row.similarity),
  }));
}

export const searchRepository = { searchProductsByVector };
export type SearchRepository = typeof searchRepository;
