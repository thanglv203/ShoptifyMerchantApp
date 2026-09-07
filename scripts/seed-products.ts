
import fs from "node:fs";
import path from "node:path";
import { generateSampleProducts, type SampleProduct } from "./lib/sample-products";


function loadDotEnv(file = ".env") {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const SHOP = process.env.SEED_SHOP_DOMAIN ?? "";
const TOKEN = process.env.SEED_ADMIN_ACCESS_TOKEN ?? "";
const COUNT = Number(process.env.SEED_COUNT ?? "300");
const API_VERSION = process.env.SEED_API_VERSION ?? "2026-07";
const DRY_RUN = process.env.SEED_DRY_RUN === "1";
const SAFE_POINTS = 300; // chờ khi bucket còn ít hơn ngưỡng này

const PRODUCT_SET = /* GraphQL */ `
  mutation SeedProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product { id title }
      userErrors { field message code }
    }
  }
`;

type GraphQLResponse = {
  data?: {
    productSet?: {
      product: { id: string; title: string } | null;
      userErrors: { field: string[] | null; message: string; code: string | null }[];
    };
  };
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number };
    };
  };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function graphql(query: string, variables: unknown): Promise<GraphQLResponse> {
  const res = await fetch(`https://${SHOP}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(`HTTP ${res.status}: token sai hoặc custom app thiếu scope write_products`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as GraphQLResponse;
}

function toProductSetInput(p: SampleProduct) {
  return {
    title: p.title,
    descriptionHtml: p.descriptionHtml ?? undefined,
    vendor: p.vendor ?? undefined,
    productType: p.productType,
    tags: p.tags,
    status: p.status,
    productOptions: p.productOptions,
    variants: p.variants.map((v) => ({
      optionValues: v.optionValues,
      price: v.price,
      sku: v.sku,
    })),
  };
}

async function createOne(p: SampleProduct, attempt = 1): Promise<GraphQLResponse> {
  const body = await graphql(PRODUCT_SET, { input: toProductSetInput(p) });

  
  const throttled = body.errors?.find((e) => e.extensions?.code === "THROTTLED");
  if (throttled) {
    if (attempt > 6) throw new Error("THROTTLED quá nhiều lần, dừng.");
    const wait = Math.min(30000, 1000 * 2 ** (attempt - 1));
    console.log(`  ⏳ THROTTLED → chờ ${wait}ms rồi thử lại (lần ${attempt})`);
    await sleep(wait);
    return createOne(p, attempt + 1);
  }
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${body.errors.map((e) => e.message).join("; ")}`);
  }

  // 2) userErrors của mutation — không throw, phải tự kiểm tra.
  const userErrors = body.data?.productSet?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `userErrors: ${userErrors.map((u) => `${(u.field ?? []).join(".")}: ${u.message}`).join("; ")}`,
    );
  }
  return body;
}


async function respectThrottle(body: GraphQLResponse) {
  const ts = body.extensions?.cost?.throttleStatus;
  if (!ts) return;
  if (ts.currentlyAvailable < SAFE_POINTS) {
    const need = SAFE_POINTS - ts.currentlyAvailable;
    const ms = Math.ceil((need / ts.restoreRate) * 1000);
    console.log(`  🐢 bucket còn ${ts.currentlyAvailable}/${ts.maximumAvailable} → chờ ${ms}ms`);
    await sleep(ms);
  }
}

async function main() {
  const products = generateSampleProducts(COUNT);
  console.log(`Sinh ${products.length} product mẫu (seed cố định).`);

  if (DRY_RUN) {
    console.log(JSON.stringify(products.slice(0, 3), null, 2));
    console.log(`... (dry run, không gọi API)`);
    return;
  }
  if (!SHOP || !TOKEN) {
    console.error("❌ Thiếu SEED_SHOP_DOMAIN hoặc SEED_ADMIN_ACCESS_TOKEN trong .env");
    process.exit(1);
  }

  const started = Date.now();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < products.length; i++) {
    const p = products[i]!;
    try {
      const body = await createOne(p);
      ok++;
      if (ok % 10 === 0 || i === products.length - 1) {
        const cost = body.extensions?.cost;
        console.log(
          `✅ ${ok}/${products.length} — cost ${cost?.actualQueryCost ?? "?"} — bucket ${
            cost?.throttleStatus.currentlyAvailable ?? "?"
          }`,
        );
      }
      await respectThrottle(body);
    } catch (err) {
      failed++;
      console.error(`❌ [${i + 1}] "${p.title}": ${(err as Error).message}`);
      if (failed >= 10) {
        console.error("Quá nhiều lỗi liên tiếp, dừng để bạn kiểm tra token/scope.");
        break;
      }
    }
  }

  const sec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\nHoàn tất: ${ok} tạo thành công, ${failed} lỗi, ${sec}s.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
