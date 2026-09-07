import type { Env } from "../lib/env.server";
import { getEnv } from "../lib/env.server";
import { PermanentError } from "../lib/errors";
import type { EmbeddingProvider } from "./embedding-provider";
import { FakeEmbeddingProvider } from "./fake-embedding";
import { GeminiEmbeddingProvider } from "./gemini-embedding.server";
import { OllamaEmbeddingProvider } from "./ollama-embedding.server";

export type EmbeddingProviderConfig = Pick<
  Env,
  | "EMBEDDING_PROVIDER"
  | "EMBEDDING_DIMENSION"
  | "GEMINI_API_KEY"
  | "GEMINI_EMBEDDING_MODEL"
  | "OLLAMA_BASE_URL"
  | "OLLAMA_EMBEDDING_MODEL"
>;

export function createEmbeddingProvider(
  config: EmbeddingProviderConfig = getEnv(),
): EmbeddingProvider {
  switch (config.EMBEDDING_PROVIDER) {
    case "fake":
      return new FakeEmbeddingProvider(config.EMBEDDING_DIMENSION);
    case "gemini":
      if (!config.GEMINI_API_KEY) {
        throw new PermanentError(
          "EMBEDDING_PROVIDER=gemini yêu cầu GEMINI_API_KEY",
        );
      }
      return new GeminiEmbeddingProvider(
        config.GEMINI_API_KEY,
        config.GEMINI_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSION,
      );
    case "ollama":
      return new OllamaEmbeddingProvider(
        config.OLLAMA_BASE_URL,
        config.OLLAMA_EMBEDDING_MODEL,
        config.EMBEDDING_DIMENSION,
      );
  }
}
