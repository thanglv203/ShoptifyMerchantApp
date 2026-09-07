import { PermanentError, TransientError } from "../lib/errors";
import {
  EMBEDDING_DIMENSION,
  normalizeEmbeddingVector,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./embedding-provider";
import type { EmbeddingFetch } from "./gemini-embedding.server";

export type OllamaEmbeddingOptions = {
  fetchFn?: EmbeddingFetch;
  timeoutMs?: number;
};

function valuesFromOllama(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const embeddings = (body as { embeddings?: unknown }).embeddings;
  if (!Array.isArray(embeddings) || !Array.isArray(embeddings[0]))
    return undefined;
  return embeddings[0];
}

/**
 * Fallback local. bge-m3 thường trả 1024 chiều; lấy 768 chiều đầu rồi normalize.
 * Document và query phải cùng provider/model/cách cắt để cosine có ý nghĩa.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "ollama";
  private readonly fetchFn: EmbeddingFetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly baseUrl = "http://localhost:11434",
    readonly model = "bge-m3",
    readonly dimension = EMBEDDING_DIMENSION,
    options: OllamaEmbeddingOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? (fetch as EmbeddingFetch);
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async embed(text: string, _taskType: EmbeddingTaskType): Promise<number[]> {
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
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        if (response.status === 429 || response.status >= 500) {
          throw new TransientError(
            `Ollama embedding HTTP ${response.status}: ${detail}`,
          );
        }
        throw new PermanentError(
          `Ollama embedding HTTP ${response.status}: ${detail}`,
        );
      }

      const raw = valuesFromOllama(await response.json());
      if (!Array.isArray(raw) || raw.length < this.dimension) {
        throw new PermanentError(
          `Ollama embedding cần ít nhất ${this.dimension} chiều, nhận ${Array.isArray(raw) ? raw.length : "không hợp lệ"}`,
        );
      }
      return normalizeEmbeddingVector(
        raw.slice(0, this.dimension),
        this.dimension,
      );
    } catch (error) {
      if (error instanceof PermanentError || error instanceof TransientError)
        throw error;
      throw new TransientError("Không kết nối được Ollama embedding", {
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
