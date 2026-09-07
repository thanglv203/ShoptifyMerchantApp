export type EmbeddingVariantInput = {
  shopifyId: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice?: string | null;
  position: number | null;
};

export type EmbeddingProductInput = {
  title: string;
  descriptionHtml: string | null;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  price: string | null;
  currencyCode: string | null;
  variants: EmbeddingVariantInput[];
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function normalizeEmbeddingText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function stripHtml(value: string): string {
  return normalizeEmbeddingText(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity: string) => {
        const key = entity.toLowerCase();
        if (key.startsWith("#x")) {
          return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
        }
        if (key.startsWith("#")) {
          return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
        }
        return NAMED_ENTITIES[key] ?? `&${entity};`;
      }),
  );
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeEmbeddingText(value);
  return normalized || null;
}

function canonicalTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => clean(tag)?.toLocaleLowerCase("vi-VN"))
        .filter((tag): tag is string => Boolean(tag)),
    ),
  ].sort();
}

function canonicalVariants(
  variants: EmbeddingVariantInput[],
): EmbeddingVariantInput[] {
  return [...variants].sort((left, right) => {
    const positionDiff =
      (left.position ?? Number.MAX_SAFE_INTEGER) -
      (right.position ?? Number.MAX_SAFE_INTEGER);
    return positionDiff || left.shopifyId.localeCompare(right.shopifyId);
  });
}

/**
 * Text deterministic dùng cho RETRIEVAL_DOCUMENT và dataHash.
 * Cố ý KHÔNG nhận inventoryQuantity để đổi tồn kho không làm hash thay đổi.
 */
export function buildEmbeddingText(product: EmbeddingProductInput): string {
  const description = product.descriptionHtml
    ? stripHtml(product.descriptionHtml)
    : null;
  const tags = canonicalTags(product.tags);
  const lines = [
    `Title: ${clean(product.title) ?? "Untitled product"}`,
    description ? `Description: ${description}` : null,
    clean(product.vendor) ? `Vendor: ${clean(product.vendor)}` : null,
    clean(product.productType)
      ? `Product type: ${clean(product.productType)}`
      : null,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
    clean(product.price)
      ? `Minimum price: ${clean(product.price)}${clean(product.currencyCode) ? ` ${clean(product.currencyCode)}` : ""}`
      : null,
  ].filter((line): line is string => Boolean(line));

  const variants = canonicalVariants(product.variants).map((variant) => {
    const parts = [
      clean(variant.title) ?? "Default Title",
      clean(variant.sku) ? `SKU: ${clean(variant.sku)}` : null,
      `Price: ${clean(variant.price) ?? "0"}`,
      clean(variant.compareAtPrice)
        ? `Compare at: ${clean(variant.compareAtPrice)}`
        : null,
    ].filter((part): part is string => Boolean(part));
    return `- ${parts.join(" | ")}`;
  });

  if (variants.length > 0) lines.push("Variants:", ...variants);
  return lines.join("\n");
}
