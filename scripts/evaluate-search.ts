import fs from "node:fs";
import path from "node:path";

try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const { getEnv } = await import("../app/lib/env.server");
const { getShopByDomain } = await import("../app/repositories/shop.repository");
const { createSearchService } =
  await import("../app/services/search.service.server");

export const EVALUATION_QUERIES = [
  "áo nam màu đen dưới 500k",
  "giày thể thao nữ màu trắng",
  "quần jean nam dưới 800k",
  "túi công sở màu pastel",
  "áo sơ mi nữ đi làm",
  "phụ kiện mùa đông dưới 300k",
] as const;

function escapeCell(value: unknown): string {
  return String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
}

const env = getEnv();
if (!env.EVAL_SHOP_DOMAIN) {
  throw new Error("Thiếu EVAL_SHOP_DOMAIN trong .env");
}
const shop = await getShopByDomain(env.EVAL_SHOP_DOMAIN);
if (!shop) throw new Error(`Không tìm thấy Shop: ${env.EVAL_SHOP_DOMAIN}`);

const service = createSearchService();
const rows: string[] = [];
for (const query of EVALUATION_QUERIES) {
  const result = await service.search(shop.id, query);
  const top5 = result.results
    .map(
      (item, index) =>
        `${index + 1}. ${item.title} (${(item.similarity * 100).toFixed(1)}%, ${item.price ?? "—"} ${item.currencyCode ?? ""})`,
    )
    .join("<br>");
  rows.push(
    `| ${escapeCell(query)} | ${escapeCell(result.semanticQuery)} | ${result.minPrice ?? "—"} | ${result.maxPrice ?? "—"} | ${escapeCell(top5 || "Không có kết quả")} |`,
  );
}

const output = `# M6 — Kết quả đánh giá Semantic Search\n\n- Shop: \`${env.EVAL_SHOP_DOMAIN}\`\n- Provider: \`${env.EMBEDDING_PROVIDER}\`\n- Model: \`${env.EMBEDDING_PROVIDER === "gemini" ? env.GEMINI_EMBEDDING_MODEL : env.EMBEDDING_PROVIDER === "ollama" ? env.OLLAMA_EMBEDDING_MODEL : "fake-feature-hash-v2"}\`\n- Dimension: \`${env.EMBEDDING_DIMENSION}\`\n- Version: \`${env.EMBEDDING_VERSION}\`\n- Thời điểm: \`${new Date().toISOString()}\`\n\n| Query | Semantic query | Min price | Max price | Top 5 |\n| --- | --- | ---: | ---: | --- |\n${rows.join("\n")}\n\n## Nhận xét thủ công\n\nĐiền nhận xét về độ liên quan, điều kiện giá, false positive và query cần cải thiện sau khi xem bảng trên.\n`;

const outputPath = path.resolve(process.cwd(), "docs/M6-search-evaluation.md");
fs.writeFileSync(outputPath, output, "utf8");
console.log(`Đã ghi bảng đánh giá: ${outputPath}`);
