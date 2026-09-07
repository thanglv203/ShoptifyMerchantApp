import { PermanentError } from "../lib/errors";
import {
  EMBEDDING_DIMENSION,
  normalizeEmbeddingVector,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./embedding-provider";

/** Hash FNV-1a 32-bit nhỏ gọn, deterministic giữa các lần chạy. */
function hashToken(token: string, seed: number): number {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (const char of token) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function tokenize(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase("vi-VN")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

/**
 * Provider deterministic dành cho test/dev offline.
 * Token giống nhau được hash vào cùng vị trí nên cosine vẫn phản ánh overlap cơ bản.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "fake";
  readonly model = "fake-token-hash-v1";

  constructor(readonly dimension = EMBEDDING_DIMENSION) {}

  async embed(text: string, _taskType: EmbeddingTaskType): Promise<number[]> {
    const tokens = tokenize(text);
    if (tokens.length === 0) {
      throw new PermanentError("Không thể embedding text rỗng");
    }

    const vector = Array<number>(this.dimension).fill(0);
    for (const token of tokens) {
      const primary = hashToken(token, 0);
      const secondary = hashToken(token, 97);
      vector[primary % this.dimension] += primary & 1 ? 1 : -1;
      vector[secondary % this.dimension] += secondary & 1 ? 0.5 : -0.5;
    }
    return normalizeEmbeddingVector(vector, this.dimension);
  }
}
