import { PermanentError, TransientError } from "../lib/errors";
import {
  EMBEDDING_DIMENSION,
  normalizeEmbeddingVector,
  type EmbeddingProvider,
  type EmbeddingTaskType,
} from "./embedding-provider";

export type EmbeddingFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

export type EmbeddingFetch = (
  url: string,
  init: RequestInit,
) => Promise<EmbeddingFetchResponse>;

export type GeminiEmbeddingOptions = {
  fetchFn?: EmbeddingFetch;
  maxRetries?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export function computeEmbeddingBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exp = Math.min(10_000, 500 * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}

function responseErrorMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") {
      return parsed.error.message.slice(0, 500);
    }
  } catch {
    // Body không phải JSON; dùng text đã giới hạn bên dưới.
  }
  return raw.slice(0, 500) || "Không có nội dung lỗi";
}

function valuesFromGemini(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const embedding = (body as { embedding?: unknown }).embedding;
  if (typeof embedding !== "object" || embedding === null) return undefined;
  return (embedding as { values?: unknown }).values;
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "gemini";
  private readonly fetchFn: EmbeddingFetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(
    private readonly apiKey: string,
    readonly model = "gemini-embedding-001",
    readonly dimension = EMBEDDING_DIMENSION,
    options: GeminiEmbeddingOptions = {},
  ) {
    if (!apiKey.trim())
      throw new PermanentError("GEMINI_API_KEY chưa được cấu hình");
    this.fetchFn = options.fetchFn ?? (fetch as EmbeddingFetch);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  async embed(text: string, taskType: EmbeddingTaskType): Promise<number[]> {
    const input = text.trim();
    if (!input) throw new PermanentError("Không thể embedding text rỗng");

    const endpoint =
      "https:" +
      `//generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:embedContent`;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetchFn(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            model: `models/${this.model}`,
            content: { parts: [{ text: input }] },
            taskType,
            outputDimensionality: this.dimension,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = responseErrorMessage(await response.text());
          if (response.status === 429 || response.status >= 500) {
            throw new TransientError(
              `Gemini embedding HTTP ${response.status}: ${detail}`,
            );
          }
          throw new PermanentError(
            `Gemini embedding HTTP ${response.status}: ${detail}`,
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
      { cause: lastError },
    );
  }
}
