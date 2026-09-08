import { T as TransientError, P as PermanentError, l as logger, g as getEnv, e as errorMessage, i as isPermanentError, a as isTransientError } from "../start-worker.js";
import "@shopify/shopify-app-react-router/adapters/node";
import { shopifyApp, AppDistribution, ApiVersion } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import "pino";
import "pg-boss";
import "zod";
if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}
const prisma = global.prismaGlobal ?? new PrismaClient();
const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true
  },
  ...process.env.SHOP_CUSTOM_DOMAIN ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] } : {}
});
ApiVersion.July26;
shopify.addDocumentResponseHeaders;
shopify.authenticate;
const unauthenticated = shopify.unauthenticated;
shopify.login;
shopify.registerWebhooks;
shopify.sessionStorage;
function computeBackoffMs(attempt, opts) {
  const base = opts?.baseMs ?? 1e3;
  const cap = opts?.capMs ?? 3e4;
  const random = opts?.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}
function computeThrottleWaitMs(status, neededPoints) {
  if (!status) return 0;
  const deficit = neededPoints - status.currentlyAvailable;
  if (deficit <= 0) return 0;
  const rate = status.restoreRate > 0 ? status.restoreRate : 50;
  return Math.ceil(deficit / rate * 1e3);
}
function classifyThrownError(err) {
  const anyErr = err;
  const status = typeof anyErr?.status === "number" ? anyErr.status : typeof anyErr?.response?.status === "number" ? anyErr.response.status : void 0;
  if (typeof status === "number") {
    if (status === 429 || status >= 500) return "transient";
    return "permanent";
  }
  return "transient";
}
const PERMANENT_GRAPHQL_CODES = /* @__PURE__ */ new Set([
  "MAX_COST_EXCEEDED",
  // query quá 1.000 điểm → phải giảm pageSize, retry vô nghĩa
  "ACCESS_DENIED",
  // thiếu scope / token sai
  "SHOP_INACTIVE"
]);
class ShopifyClient {
  constructor(graphqlFn, log, opts = {}) {
    this.graphqlFn = graphqlFn;
    this.log = log;
    this.opts = opts;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }
  graphqlFn;
  log;
  opts;
  sleep;
  get safetyPoints() {
    return this.opts.safetyPoints ?? 250;
  }
  async request(query, variables) {
    const maxRetries = this.opts.maxRetries ?? 5;
    let lastErr;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.graphqlFn(
          query,
          variables ? { variables } : void 0
        );
        const body = await res.json();
        const cost = body.extensions?.cost;
        const errors = body.errors ?? [];
        if (errors.length > 0) {
          const throttled = errors.some(
            (e) => e.extensions?.code === "THROTTLED"
          );
          if (throttled) {
            const wait = computeThrottleWaitMs(
              cost?.throttleStatus,
              cost?.requestedQueryCost ?? this.safetyPoints
            ) || computeBackoffMs(attempt, { random: this.opts.random });
            lastErr = new TransientError("Shopify GraphQL THROTTLED");
            this.log.warn({ attempt, waitMs: wait }, "THROTTLED — chờ rồi thử lại");
            await this.sleep(wait);
            continue;
          }
          const message = errors.map((e) => e.message).join("; ");
          const codes = errors.map((e) => e.extensions?.code).filter(Boolean);
          if (codes.some((c) => PERMANENT_GRAPHQL_CODES.has(c))) {
            throw new PermanentError(`GraphQL [${codes.join(",")}]: ${message}`);
          }
          if (codes.every((c) => c === "INTERNAL_SERVER_ERROR") && codes.length > 0) {
            lastErr = new TransientError(`Shopify INTERNAL_SERVER_ERROR: ${message}`);
            const wait = computeBackoffMs(attempt, { random: this.opts.random });
            this.log.warn({ attempt, waitMs: wait }, "Shopify 5xx (GraphQL) — retry");
            await this.sleep(wait);
            continue;
          }
          throw new PermanentError(`GraphQL errors: ${message}`);
        }
        if (body.data === void 0 || body.data === null) {
          throw new PermanentError("GraphQL response không có data");
        }
        const proactiveWait = computeThrottleWaitMs(
          cost?.throttleStatus,
          this.safetyPoints
        );
        if (proactiveWait > 0) {
          this.log.debug(
            {
              waitMs: proactiveWait,
              available: cost?.throttleStatus.currentlyAvailable
            },
            "bucket sắp cạn — chờ hồi điểm"
          );
          await this.sleep(proactiveWait);
        }
        return { data: body.data, cost };
      } catch (err) {
        if (err instanceof PermanentError) throw err;
        if (classifyThrownError(err) === "permanent") {
          throw new PermanentError(
            `Shopify API lỗi không thể retry: ${String(err?.message ?? err)}`,
            { cause: err }
          );
        }
        lastErr = err;
        const wait = computeBackoffMs(attempt, { random: this.opts.random });
        this.log.warn(
          { attempt, waitMs: wait, err: String(err?.message ?? err) },
          "lỗi tạm thời khi gọi Shopify — retry"
        );
        await this.sleep(wait);
      }
    }
    throw new TransientError(
      `Shopify API vẫn lỗi sau ${maxRetries + 1} lần thử: ${String(
        lastErr?.message ?? lastErr
      )}`,
      { cause: lastErr }
    );
  }
}
function emptyToNull(value) {
  if (value === null || value === void 0) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
function mapVariant(v) {
  return {
    shopifyId: v.legacyResourceId,
    gid: v.id,
    title: emptyToNull(v.title) ?? "Default Title",
    sku: emptyToNull(v.sku),
    price: emptyToNull(v.price) ?? "0",
    compareAtPrice: emptyToNull(v.compareAtPrice),
    inventoryQuantity: v.inventoryQuantity ?? null,
    position: v.position ?? null
  };
}
function mapProductNode(node) {
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
    variantsTruncated: node.variants?.pageInfo?.hasNextPage === true
  };
}
function shouldSkipUpdate(existingShopifyUpdatedAt, incomingShopifyUpdatedAt) {
  if (!existingShopifyUpdatedAt || !incomingShopifyUpdatedAt) return false;
  return existingShopifyUpdatedAt.getTime() > incomingShopifyUpdatedAt.getTime();
}
async function upsertProductFromShopify(shopId, input) {
  const shopifyId = BigInt(input.shopifyId);
  const incomingUpdatedAt = input.shopifyUpdatedAt ? new Date(input.shopifyUpdatedAt) : null;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({
      where: { shopId_shopifyId: { shopId, shopifyId } },
      select: { id: true, shopifyUpdatedAt: true }
    });
    if (existing && shouldSkipUpdate(existing.shopifyUpdatedAt, incomingUpdatedAt)) {
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
      price: input.price,
      // Prisma Decimal nhận string
      currencyCode: input.currencyCode,
      shopifyCreatedAt: input.shopifyCreatedAt ? new Date(input.shopifyCreatedAt) : null,
      shopifyUpdatedAt: incomingUpdatedAt,
      syncedAt: /* @__PURE__ */ new Date(),
      deletedAt: null
    };
    const product = existing ? await tx.product.update({ where: { id: existing.id }, data }) : await tx.product.create({ data: { ...data, shopId, shopifyId } });
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
          position: v.position
        }))
      });
    }
    return {
      action: existing ? "updated" : "created",
      productId: product.id
    };
  });
}
async function getShopById(id) {
  return prisma.shop.findUnique({ where: { id } });
}
async function markShopSynced(shopId, at = /* @__PURE__ */ new Date()) {
  return prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncedAt: at }
  });
}
async function getSyncJobRecord(jobId) {
  return prisma.syncJob.findUnique({ where: { id: jobId } });
}
async function markSyncJobRunning(jobId) {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { startedAt: true }
  });
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: job?.startedAt ?? /* @__PURE__ */ new Date() }
  });
}
async function setSyncJobTotal(jobId, total) {
  await prisma.syncJob.update({ where: { id: jobId }, data: { totalCount: total } });
}
async function checkpointSyncJob(jobId, args) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      cursor: args.cursor,
      processedCount: { increment: args.processed }
    }
  });
}
async function completeSyncJob(jobId) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      finishedAt: /* @__PURE__ */ new Date(),
      activeLockKey: null,
      // nhả khoá
      error: null
    }
  });
}
async function failSyncJob(jobId, message) {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: /* @__PURE__ */ new Date(),
      activeLockKey: null,
      // nhả khoá để có thể resume/tạo job mới
      error: message.slice(0, 2e3)
    }
  });
}
const PRODUCTS_COUNT_QUERY = (
  /* GraphQL */
  `
  query ProductsCount {
    productsCount {
      count
    }
  }
`
);
const PRODUCTS_PAGE_QUERY = (
  /* GraphQL */
  `
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
`
);
async function runSyncJob(jobId) {
  const log = logger.child({ module: "product-sync", jobId });
  const job = await getSyncJobRecord(jobId);
  if (!job) {
    log.error("SyncJob không tồn tại");
    return null;
  }
  const shop = await getShopById(job.shopId);
  if (!shop) {
    await failSyncJob(jobId, "Shop không tồn tại trong DB");
    return null;
  }
  const shopLog = log.child({ shop: shop.domain });
  try {
    await markSyncJobRunning(jobId);
    const { admin } = await unauthenticated.admin(shop.domain);
    const client = new ShopifyClient(
      (query, options) => admin.graphql(query, options),
      shopLog
    );
    if (job.processedCount === 0) {
      const { data } = await client.request(PRODUCTS_COUNT_QUERY);
      const total = data.productsCount?.count;
      if (typeof total === "number") await setSyncJobTotal(jobId, total);
      shopLog.info({ total }, "bắt đầu full sync");
    } else {
      shopLog.info(
        { processed: job.processedCount, cursor: job.cursor },
        "resume sync từ checkpoint"
      );
    }
    const pageSize = getEnv().SYNC_PAGE_SIZE;
    let cursor = job.cursor;
    let hasNextPage = true;
    let page = 0;
    while (hasNextPage) {
      const { data, cost } = await client.request(
        PRODUCTS_PAGE_QUERY,
        { pageSize, cursor }
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
            "product có > 20 variants — chỉ sync 20 đầu (đầy đủ cần Bulk Operations)"
          );
        }
        const result = await upsertProductFromShopify(job.shopId, input);
        if (result.action === "created") created += 1;
        else if (result.action === "updated") updated += 1;
        else skipped += 1;
      }
      cursor = pageInfo.endCursor;
      hasNextPage = pageInfo.hasNextPage;
      await checkpointSyncJob(jobId, { cursor, processed: nodes.length });
      shopLog.info(
        {
          page,
          items: nodes.length,
          created,
          updated,
          skipped,
          actualCost: cost?.actualQueryCost ?? null,
          bucketAvailable: cost?.throttleStatus.currentlyAvailable ?? null
        },
        "sync page done"
      );
      if (nodes.length === 0) break;
    }
    await markShopSynced(job.shopId);
    await completeSyncJob(jobId);
    shopLog.info("sync COMPLETED");
    return { shopId: job.shopId };
  } catch (err) {
    const message = errorMessage(err);
    shopLog.error(
      { err: message },
      "sync FAILED — cursor đã checkpoint, có thể Resume"
    );
    try {
      await failSyncJob(jobId, message);
    } catch (updateErr) {
      shopLog.error(
        { err: errorMessage(updateErr) },
        "không ghi được trạng thái FAILED"
      );
    }
    return null;
  }
}
function createEmbeddingDataHash(input) {
  const canonical = JSON.stringify([
    input.provider,
    input.model,
    input.dimension,
    input.version,
    input.text
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
async function getProductForEmbedding(productId) {
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    include: { variants: { orderBy: [{ position: "asc" }, { id: "asc" }] } }
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
      position: variant.position
    }))
  };
}
async function listProductIdsForEmbeddingBatch(shopId, args) {
  const products = await prisma.product.findMany({
    where: { shopId, deletedAt: null },
    orderBy: { id: "asc" },
    take: args.limit,
    ...args.cursor ? { cursor: { id: args.cursor }, skip: 1 } : {},
    select: { id: true }
  });
  return {
    productIds: products.map((product) => product.id),
    nextCursor: products.length === args.limit ? products[products.length - 1]?.id ?? null : null
  };
}
async function getEmbeddingMetadata(productId) {
  const row = await prisma.productEmbedding.findUnique({
    where: { productId },
    select: {
      model: true,
      dimension: true,
      version: true,
      dataHash: true,
      status: true
    }
  });
  return row;
}
async function markEmbeddingPending(input) {
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
      embeddedAt: null
    }
  });
}
async function saveEmbeddingReady(input) {
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
async function markEmbeddingFailed(productId, message) {
  await prisma.productEmbedding.updateMany({
    where: { productId },
    data: { status: "FAILED", error: message.slice(0, 2e3), embeddedAt: null }
  });
}
const embeddingRepository = {
  getProductForEmbedding,
  listProductIdsForEmbeddingBatch,
  getEmbeddingMetadata,
  markEmbeddingPending,
  saveEmbeddingReady,
  markEmbeddingFailed
};
const EMBEDDING_DIMENSION = 768;
function validateEmbeddingVector(vector, expectedDimension = EMBEDDING_DIMENSION) {
  if (!Array.isArray(vector) || vector.length !== expectedDimension) {
    throw new PermanentError(
      `Embedding phải có đúng ${expectedDimension} chiều, nhận ${Array.isArray(vector) ? vector.length : "không phải array"}`
    );
  }
  const values = vector.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new PermanentError("Embedding chứa giá trị không phải số hữu hạn");
  }
  return values;
}
function normalizeEmbeddingVector(vector, expectedDimension = EMBEDDING_DIMENSION) {
  const values = validateEmbeddingVector(vector, expectedDimension);
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0)
  );
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new PermanentError("Embedding có độ dài bằng 0");
  }
  return values.map((value) => value / magnitude);
}
const STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "an",
  "and",
  "at",
  "compare",
  "description",
  "giá",
  "minimum",
  "màu",
  "price",
  "product",
  "sku",
  "sản",
  "phẩm",
  "tags",
  "the",
  "title",
  "type",
  "variants",
  "vnd",
  "vendor"
]);
const TOKEN_ALIASES = {
  black: "đen",
  female: "nữ",
  man: "nam",
  male: "nam",
  men: "nam",
  office: "công_sở",
  sneaker: "giày_thể_thao",
  sneakers: "giày_thể_thao",
  tee: "áo_thun",
  tshirt: "áo_thun",
  white: "trắng",
  woman: "nữ",
  women: "nữ"
};
const PHRASE_ALIASES = [
  [/t[\s-]?shirt/giu, "áo_thun"],
  [/áo\s+thun/giu, "áo_thun"],
  [/áo\s+sơ\s+mi/giu, "áo_sơ_mi"],
  [/sơ\s+mi/giu, "sơ_mi"],
  [/giày\s+thể\s+thao/giu, "giày_thể_thao"],
  [/quần\s+jean/giu, "quần_jean"],
  [/phụ\s+kiện/giu, "phụ_kiện"],
  [/đi\s+làm/giu, "công_sở"],
  [/văn\s+phòng/giu, "công_sở"],
  [/công\s+sở/giu, "công_sở"]
];
const COLORS = /* @__PURE__ */ new Set([
  "be",
  "đen",
  "đỏ",
  "hồng",
  "nâu",
  "pastel",
  "tím",
  "trắng",
  "vàng",
  "xám",
  "xanh"
]);
const CATEGORIES = /* @__PURE__ */ new Set([
  "áo",
  "áo_sơ_mi",
  "áo_thun",
  "giày",
  "giày_thể_thao",
  "phụ_kiện",
  "quần",
  "quần_jean",
  "túi",
  "váy"
]);
function hashFeature(feature, seed) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (const char of feature) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
function normalizePhrases(text) {
  let normalized = text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}
function tokenize(text) {
  return (normalizePhrases(text).match(/[\p{L}\p{N}_-]+/gu) ?? []).map((token) => TOKEN_ALIASES[token] ?? token).filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}
function addFeature(vector, feature, weight) {
  const projections = [
    { seed: 0, scale: 1 },
    { seed: 97, scale: 0.6 },
    { seed: 193, scale: 0.35 }
  ];
  for (const projection of projections) {
    const hash = hashFeature(feature, projection.seed);
    const sign = hash & 1 ? 1 : -1;
    vector[hash % vector.length] += sign * weight * projection.scale;
  }
}
function lineWeight(line, taskType) {
  if (taskType === "RETRIEVAL_QUERY") return 3;
  const normalized = line.trim().toLocaleLowerCase("en-US");
  if (normalized.startsWith("title:")) return 4;
  if (normalized.startsWith("tags:")) return 3;
  if (normalized.startsWith("product type:")) return 3;
  if (normalized.startsWith("- ")) return 2;
  if (normalized.startsWith("description:")) return 1;
  return 1;
}
function addAttributeFeatures(vector, token, weight) {
  if (token === "nam") {
    addFeature(vector, "attribute:gender", weight * 4);
    addFeature(vector, "gender:nam", weight * 3);
  } else if (token === "nữ") {
    addFeature(vector, "attribute:gender", weight * -4);
    addFeature(vector, "gender:nữ", weight * 3);
  } else if (token === "unisex") {
    addFeature(vector, "gender:unisex", weight * 2);
  }
  if (COLORS.has(token)) {
    addFeature(vector, `color:${token}`, weight * 4);
    if (token === "đen")
      addFeature(vector, "attribute:black-white", weight * 3);
    if (token === "trắng") {
      addFeature(vector, "attribute:black-white", weight * -3);
    }
  }
  if (CATEGORIES.has(token)) {
    addFeature(vector, `category:${token}`, weight * 3);
  }
}
class FakeEmbeddingProvider {
  constructor(dimension = EMBEDDING_DIMENSION) {
    this.dimension = dimension;
  }
  dimension;
  provider = "fake";
  model = "fake-feature-hash-v2";
  async embed(text, taskType) {
    const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      throw new PermanentError("Không thể embedding text rỗng");
    }
    const vector = Array(this.dimension).fill(0);
    let featureCount = 0;
    for (const line of lines) {
      const weight = lineWeight(line, taskType);
      const tokens = tokenize(line);
      for (const token of tokens) {
        addFeature(vector, `token:${token}`, weight);
        addAttributeFeatures(vector, token, weight);
        featureCount += 1;
      }
      for (let index = 0; index < tokens.length - 1; index += 1) {
        addFeature(
          vector,
          `bigram:${tokens[index]}_${tokens[index + 1]}`,
          weight * 1.5
        );
        featureCount += 1;
      }
    }
    if (featureCount === 0) {
      throw new PermanentError("Text không có feature hợp lệ để embedding");
    }
    return normalizeEmbeddingVector(vector, this.dimension);
  }
}
function computeEmbeddingBackoffMs(attempt, random = Math.random) {
  const exp = Math.min(1e4, 500 * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}
function responseErrorMessage(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message.slice(0, 500);
    }
  } catch {
  }
  return raw.slice(0, 500) || "Không có nội dung lỗi";
}
function valuesFromGemini(body) {
  if (typeof body !== "object" || body === null) return void 0;
  const embedding = body.embedding;
  if (typeof embedding !== "object" || embedding === null) return void 0;
  return embedding.values;
}
class GeminiEmbeddingProvider {
  constructor(apiKey, model = "gemini-embedding-001", dimension = EMBEDDING_DIMENSION, options = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimension = dimension;
    if (!apiKey.trim())
      throw new PermanentError("GEMINI_API_KEY chưa được cấu hình");
    this.fetchFn = options.fetchFn ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15e3;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }
  apiKey;
  model;
  dimension;
  provider = "gemini";
  fetchFn;
  maxRetries;
  timeoutMs;
  sleep;
  random;
  async embed(text, taskType) {
    const input = text.trim();
    if (!input) throw new PermanentError("Không thể embedding text rỗng");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:embedContent`;
    let lastError;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchFn(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey
          },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text: input }] },
            taskType,
            outputDimensionality: this.dimension
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          const detail = responseErrorMessage(await response.text());
          if (response.status === 429 || response.status >= 500) {
            throw new TransientError(
              `Gemini embedding HTTP ${response.status}: ${detail}`
            );
          }
          throw new PermanentError(
            `Gemini embedding HTTP ${response.status}: ${detail}`
          );
        }
        const body = await response.json();
        return normalizeEmbeddingVector(valuesFromGemini(body), this.dimension);
      } catch (error) {
        if (error instanceof PermanentError) throw error;
        lastError = error;
        if (attempt >= this.maxRetries) break;
        await this.sleep(computeEmbeddingBackoffMs(attempt, this.random));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new TransientError(
      `Gemini embedding vẫn lỗi sau ${this.maxRetries + 1} lần thử`,
      { cause: lastError }
    );
  }
}
function valuesFromOllama(body) {
  if (typeof body !== "object" || body === null) return void 0;
  const embeddings = body.embeddings;
  if (!Array.isArray(embeddings) || !Array.isArray(embeddings[0]))
    return void 0;
  return embeddings[0];
}
class OllamaEmbeddingProvider {
  constructor(baseUrl = "http://localhost:11434", model = "bge-m3", dimension = EMBEDDING_DIMENSION, options = {}) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.dimension = dimension;
    this.fetchFn = options.fetchFn ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 3e4;
  }
  baseUrl;
  model;
  dimension;
  provider = "ollama";
  fetchFn;
  timeoutMs;
  async embed(text, taskType) {
    const input = text.trim();
    if (!input) throw new PermanentError("Không thể embedding text rỗng");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(
        `${this.baseUrl.replace(/\/$/, "")}/api/embed`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: this.model, input, truncate: true }),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (response.status === 429 || response.status >= 500) {
          throw new TransientError(
            `Ollama embedding HTTP ${response.status}: ${detail}`
          );
        }
        throw new PermanentError(
          `Ollama embedding HTTP ${response.status}: ${detail}`
        );
      }
      const raw = valuesFromOllama(await response.json());
      if (!Array.isArray(raw) || raw.length < this.dimension) {
        throw new PermanentError(
          `Ollama embedding cần ít nhất ${this.dimension} chiều, nhận ${Array.isArray(raw) ? raw.length : "không hợp lệ"}`
        );
      }
      return normalizeEmbeddingVector(
        raw.slice(0, this.dimension),
        this.dimension
      );
    } catch (error) {
      if (error instanceof PermanentError || error instanceof TransientError)
        throw error;
      throw new TransientError("Không kết nối được Ollama embedding", {
        cause: error
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
function createEmbeddingProvider(config = getEnv()) {
  switch (config.EMBEDDING_PROVIDER) {
    case "fake":
      return new FakeEmbeddingProvider(config.EMBEDDING_DIMENSION);
    case "gemini":
      if (!config.GEMINI_API_KEY) {
        throw new PermanentError(
          "EMBEDDING_PROVIDER=gemini yêu cầu GEMINI_API_KEY"
        );
      }
      return new GeminiEmbeddingProvider(
        config.GEMINI_API_KEY,
        config.GEMINI_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSION
      );
    case "ollama":
      return new OllamaEmbeddingProvider(
        config.OLLAMA_BASE_URL,
        config.OLLAMA_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSION
      );
  }
}
const NAMED_ENTITIES = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"'
};
function normalizeEmbeddingText(value) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
function stripHtml(value) {
  return normalizeEmbeddingText(
    value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_match, entity) => {
      const key = entity.toLowerCase();
      if (key.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      }
      if (key.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      }
      return NAMED_ENTITIES[key] ?? `&${entity};`;
    })
  );
}
function clean(value) {
  if (!value) return null;
  const normalized = normalizeEmbeddingText(value);
  return normalized || null;
}
function canonicalTags(tags) {
  return [
    ...new Set(
      tags.map((tag) => clean(tag)?.toLocaleLowerCase("vi-VN")).filter((tag) => Boolean(tag))
    )
  ].sort();
}
function canonicalVariants(variants) {
  return [...variants].sort((left, right) => {
    const positionDiff = (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER);
    return positionDiff || left.shopifyId.localeCompare(right.shopifyId);
  });
}
function buildEmbeddingText(product) {
  const description = product.descriptionHtml ? stripHtml(product.descriptionHtml) : null;
  const tags = canonicalTags(product.tags);
  const lines = [
    `Title: ${clean(product.title) ?? "Untitled product"}`,
    description ? `Description: ${description}` : null,
    clean(product.vendor) ? `Vendor: ${clean(product.vendor)}` : null,
    clean(product.productType) ? `Product type: ${clean(product.productType)}` : null,
    tags.length > 0 ? `Tags: ${tags.join(", ")}` : null,
    clean(product.price) ? `Minimum price: ${clean(product.price)}${clean(product.currencyCode) ? ` ${clean(product.currencyCode)}` : ""}` : null
  ].filter((line) => Boolean(line));
  const variants = canonicalVariants(product.variants).map((variant) => {
    const parts = [
      clean(variant.title) ?? "Default Title",
      clean(variant.sku) ? `SKU: ${clean(variant.sku)}` : null,
      `Price: ${clean(variant.price) ?? "0"}`,
      clean(variant.compareAtPrice) ? `Compare at: ${clean(variant.compareAtPrice)}` : null
    ].filter((part) => Boolean(part));
    return `- ${parts.join(" | ")}`;
  });
  if (variants.length > 0) lines.push("Variants:", ...variants);
  return lines.join("\n");
}
class EmbeddingService {
  constructor(provider, repository, options) {
    this.provider = provider;
    this.repository = repository;
    this.options = options;
  }
  provider;
  repository;
  options;
  async embedProduct(productId, jobId) {
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
      text
    });
    const current = await this.repository.getEmbeddingMetadata(productId);
    if (current?.status === "READY" && current.model === this.provider.model && current.dimension === this.provider.dimension && current.version === this.options.version && current.dataHash === dataHash) {
      logger.info(
        { jobId, shopId: product.shopId, productId, dataHash },
        "embedding skipped: HASH_UNCHANGED"
      );
      return { outcome: "skipped", productId, reason: "HASH_UNCHANGED" };
    }
    await this.repository.markEmbeddingPending({
      productId,
      model: this.provider.model,
      dimension: this.provider.dimension,
      version: this.options.version,
      dataHash
    });
    try {
      const vector = validateEmbeddingVector(
        await this.provider.embed(text, "RETRIEVAL_DOCUMENT"),
        this.provider.dimension
      );
      await this.repository.saveEmbeddingReady({ productId, vector });
      logger.info(
        { jobId, shopId: product.shopId, productId, dataHash },
        "embedding READY"
      );
      return { outcome: "embedded", productId, dataHash };
    } catch (error) {
      const message = errorMessage(error);
      try {
        await this.repository.markEmbeddingFailed(productId, message);
      } catch (statusError) {
        logger.error(
          { jobId, productId, err: errorMessage(statusError) },
          "không ghi được trạng thái embedding FAILED"
        );
      }
      logger.error(
        {
          jobId,
          shopId: product.shopId,
          productId,
          errorKind: isPermanentError(error) ? "permanent" : "transient",
          err: message
        },
        "embedding FAILED"
      );
      throw error;
    }
  }
  async embedShop(shopId, jobId) {
    const totals = { embedded: 0, skipped: 0, failed: 0 };
    let cursor = null;
    let batch = 0;
    do {
      const page = await this.repository.listProductIdsForEmbeddingBatch(
        shopId,
        {
          cursor,
          limit: this.options.batchSize
        }
      );
      if (page.productIds.length === 0) break;
      batch += 1;
      let firstTransient;
      for (let offset = 0; offset < page.productIds.length; offset += this.options.concurrency) {
        const chunk = page.productIds.slice(
          offset,
          offset + this.options.concurrency
        );
        const results = await Promise.allSettled(
          chunk.map((productId) => this.embedProduct(productId, jobId))
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
        "embedding batch done"
      );
      if (firstTransient) throw firstTransient;
      cursor = page.nextCursor;
    } while (cursor);
    return totals;
  }
}
function createEmbeddingService() {
  const env = getEnv();
  return new EmbeddingService(
    createEmbeddingProvider(env),
    embeddingRepository,
    {
      version: env.EMBEDDING_VERSION,
      batchSize: env.EMBEDDING_BATCH_SIZE,
      concurrency: env.EMBEDDING_CONCURRENCY
    }
  );
}
async function handleSyncProductsJob(payload) {
  return runSyncJob(payload.jobId);
}
async function handleEmbedProductJob(payload, pgBossJobId) {
  try {
    await createEmbeddingService().embedProduct(payload.productId, pgBossJobId);
  } catch (error) {
    if (isPermanentError(error)) {
      logger.warn(
        {
          jobId: pgBossJobId,
          shopId: payload.shopId,
          productId: payload.productId,
          err: errorMessage(error)
        },
        "embedding permanent error — không retry"
      );
      return;
    }
    logger.error(
      {
        jobId: pgBossJobId,
        shopId: payload.shopId,
        productId: payload.productId,
        err: errorMessage(error)
      },
      "embedding transient error — pg-boss sẽ retry"
    );
    throw error;
  }
}
async function handleEmbedShopJob(payload, pgBossJobId) {
  try {
    await createEmbeddingService().embedShop(payload.shopId, pgBossJobId);
  } catch (error) {
    if (isPermanentError(error)) {
      logger.warn(
        {
          jobId: pgBossJobId,
          shopId: payload.shopId,
          err: errorMessage(error)
        },
        "embed-shop permanent error — không retry"
      );
      return;
    }
    logger.error(
      { jobId: pgBossJobId, shopId: payload.shopId, err: errorMessage(error) },
      "embed-shop transient error — pg-boss sẽ retry"
    );
    throw error;
  }
}
export {
  handleEmbedProductJob,
  handleEmbedShopJob,
  handleSyncProductsJob
};
//# sourceMappingURL=handlers.server-DNsJUWoC.js.map
