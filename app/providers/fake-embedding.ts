import { PermanentError } from "../lib/errors";
import {
  EMBEDDING_DIMENSION,
  normalizeEmbeddingVector,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./embedding-provider";

const STOP_WORDS = new Set([
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
  "vendor",
]);

const TOKEN_ALIASES: Record<string, string> = {
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
  women: "nữ",
};

const PHRASE_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/t[\s-]?shirt/giu, "áo_thun"],
  [/áo\s+thun/giu, "áo_thun"],
  [/áo\s+sơ\s+mi/giu, "áo_sơ_mi"],
  [/sơ\s+mi/giu, "sơ_mi"],
  [/giày\s+thể\s+thao/giu, "giày_thể_thao"],
  [/quần\s+jean/giu, "quần_jean"],
  [/phụ\s+kiện/giu, "phụ_kiện"],
  [/đi\s+làm/giu, "công_sở"],
  [/văn\s+phòng/giu, "công_sở"],
  [/công\s+sở/giu, "công_sở"],
];

const COLORS = new Set([
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
  "xanh",
]);

const CATEGORIES = new Set([
  "áo",
  "áo_sơ_mi",
  "áo_thun",
  "giày",
  "giày_thể_thao",
  "phụ_kiện",
  "quần",
  "quần_jean",
  "túi",
  "váy",
]);

/** Hash FNV-1a 32-bit nhỏ gọn, deterministic giữa các lần chạy. */
function hashFeature(feature: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const char of feature) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizePhrases(text: string): string {
  let normalized = text.normalize("NFKC").toLocaleLowerCase("vi-VN");
  for (const [pattern, replacement] of PHRASE_ALIASES) {
    normalized = normalized.replace(pattern, replacement);
  }
  return normalized;
}

function tokenize(text: string): string[] {
  return (normalizePhrases(text).match(/[\p{L}\p{N}_-]+/gu) ?? [])
    .map((token) => TOKEN_ALIASES[token] ?? token)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function addFeature(vector: number[], feature: string, weight: number): void {
  const projections = [
    { seed: 0, scale: 1 },
    { seed: 97, scale: 0.6 },
    { seed: 193, scale: 0.35 },
  ];
  for (const projection of projections) {
    const hash = hashFeature(feature, projection.seed);
    const sign = hash & 1 ? 1 : -1;
    vector[hash % vector.length] += sign * weight * projection.scale;
  }
}

function lineWeight(line: string, taskType: EmbeddingTaskType): number {
  if (taskType === "RETRIEVAL_QUERY") return 3;
  const normalized = line.trim().toLocaleLowerCase("en-US");
  if (normalized.startsWith("title:")) return 4;
  if (normalized.startsWith("tags:")) return 3;
  if (normalized.startsWith("product type:")) return 3;
  if (normalized.startsWith("- ")) return 2;
  if (normalized.startsWith("description:")) return 1;
  return 1;
}

function addAttributeFeatures(
  vector: number[],
  token: string,
  weight: number,
): void {
  if (token === "nam") {
    addFeature(vector, "attribute:gender", weight * 4);
    addFeature(vector, "gender:nam", weight * 3);
  } else if (token === "nữ") {
    // Chung một trục nhưng ngược dấu: nam và nữ bị phạt thay vì chỉ không khớp.
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

/**
 * Provider local deterministic dành cho test/dev.
 * V2 ưu tiên title/tags/type, thêm phrase + bigram và feature riêng cho giới tính/màu.
 * Nó cho kết quả trực quan hơn V1 nhưng vẫn không thay thế model semantic thật.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "fake";
  readonly model = "fake-feature-hash-v2";

  constructor(readonly dimension = EMBEDDING_DIMENSION) {}

  async embed(text: string, taskType: EmbeddingTaskType): Promise<number[]> {
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      throw new PermanentError("Không thể embedding text rỗng");
    }

    const vector = Array<number>(this.dimension).fill(0);
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
          weight * 1.5,
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
