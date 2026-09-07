import { getEnv } from "../lib/env.server";
import { PermanentError } from "../lib/errors";
import {
  validateEmbeddingVector,
  type EmbeddingProvider,
} from "../providers/embedding-provider";
import { createEmbeddingProvider } from "../providers/embedding-provider.factory.server";
import {
  searchRepository,
  type SearchProductResult,
  type SearchRepository,
} from "../repositories/search.repository";
import { parsePriceConstraint } from "./price-constraint";

export type SearchResponse = {
  query: string;
  semanticQuery: string;
  minPrice: number | null;
  maxPrice: number | null;
  results: SearchProductResult[];
};

export class SearchService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly repository: SearchRepository,
    private readonly version: number,
  ) {}

  async search(shopId: string, rawQuery: string): Promise<SearchResponse> {
    const query = rawQuery.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!query) throw new PermanentError("Nhập nội dung cần tìm kiếm.");
    if (query.length > 500) {
      throw new PermanentError(
        "Truy vấn tìm kiếm không được vượt quá 500 ký tự.",
      );
    }

    const constraint = parsePriceConstraint(query);
    // Query chỉ có điều kiện giá vẫn cần một vector để xếp hạng tổng quát.
    const semanticQuery = constraint.semanticQuery || "sản phẩm";
    const vector = validateEmbeddingVector(
      await this.provider.embed(semanticQuery, "RETRIEVAL_QUERY"),
      this.provider.dimension,
    );
    const results = await this.repository.searchProductsByVector({
      shopId,
      vector,
      model: this.provider.model,
      dimension: this.provider.dimension,
      version: this.version,
      minPrice: constraint.minPrice,
      maxPrice: constraint.maxPrice,
      limit: 5,
    });

    return {
      query,
      semanticQuery,
      minPrice: constraint.minPrice,
      maxPrice: constraint.maxPrice,
      results,
    };
  }
}

export function createSearchService(): SearchService {
  const env = getEnv();
  return new SearchService(
    createEmbeddingProvider(env),
    searchRepository,
    env.EMBEDDING_VERSION,
  );
}
