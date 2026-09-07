import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { errorMessage, isPermanentError } from "../lib/errors";
import { logger } from "../lib/logger.server";
import { formatMoney } from "../lib/money";
import { getOrCreateShop } from "../repositories/shop.repository";
import { createSearchService } from "../services/search.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return { q, search: null, error: null };

  try {
    const search = await createSearchService().search(shop.id, q);
    return { q, search, error: null };
  } catch (error) {
    const message = errorMessage(error);
    logger.error({ shop: shop.domain, err: message }, "semantic search failed");
    return {
      q,
      search: null,
      error: isPermanentError(error)
        ? message
        : "Tìm kiếm tạm thời gặp lỗi. Vui lòng thử lại sau.",
    };
  }
};

function formatScore(similarity: number): string {
  return `${(similarity * 100).toFixed(1)}%`;
}

export default function SearchPage() {
  const { q, search, error } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/app/search";

  return (
    <s-page heading="Semantic Product Search">
      <s-button slot="primary-action" href="/app/products" variant="secondary">
        Xem Products
      </s-button>

      <s-section heading="Tìm bằng ngôn ngữ tự nhiên">
        <Form method="get">
          <s-stack direction="block" gap="base">
            <s-text-field
              label="Nhu cầu sản phẩm"
              name="q"
              value={q}
              placeholder="Ví dụ: áo nam màu đen dưới 500k"
            />
            <s-button type="submit" variant="primary">
              Tìm kiếm
            </s-button>
          </s-stack>
        </Form>
        {isSearching ? (
          <s-paragraph>
            <s-spinner size="base" /> Đang tạo query embedding và tìm Top 5…
          </s-paragraph>
        ) : null}
      </s-section>

      {error ? (
        <s-banner tone="critical" heading="Không tìm kiếm được">
          <s-paragraph>{error}</s-paragraph>
        </s-banner>
      ) : null}

      {search ? (
        <>
          <s-section heading="Query đã phân tích">
            <s-stack direction="block" gap="small-300">
              <s-paragraph>
                Semantic query: <s-text>{search.semanticQuery}</s-text>
              </s-paragraph>
              <s-paragraph>
                Giá tối thiểu: {formatMoney(search.minPrice, "VND")} · Giá tối
                đa: {formatMoney(search.maxPrice, "VND")}
              </s-paragraph>
            </s-stack>
          </s-section>

          <s-section heading={`Top ${search.results.length} kết quả`}>
            {search.results.length === 0 ? (
              <s-banner tone="info" heading="Không có kết quả phù hợp">
                <s-paragraph>
                  Kiểm tra ProductEmbedding đã READY, provider/model/version
                  đang dùng có khớp lúc index và điều kiện giá không quá chặt.
                </s-paragraph>
              </s-banner>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">Sản phẩm</s-table-header>
                  <s-table-header>Loại / Vendor</s-table-header>
                  <s-table-header format="numeric">Giá</s-table-header>
                  <s-table-header format="numeric">Similarity</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {search.results.map((product) => (
                    <s-table-row key={product.id}>
                      <s-table-cell>
                        <s-stack direction="inline" gap="base">
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.imageAlt ?? product.title}
                              width={48}
                              height={48}
                              loading="lazy"
                              style={{ objectFit: "cover", borderRadius: 8 }}
                            />
                          ) : null}
                          <s-text>{product.title}</s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        {[product.productType, product.vendor]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </s-table-cell>
                      <s-table-cell>
                        {formatMoney(product.price, product.currencyCode)}
                      </s-table-cell>
                      <s-table-cell>
                        {formatScore(product.similarity)}
                      </s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>
            )}
          </s-section>
        </>
      ) : null}

      {!q && !error ? (
        <s-banner tone="info" heading="Thử một truy vấn semantic">
          <s-paragraph>
            Hệ thống tách điều kiện giá khỏi câu, embed phần mô tả bằng
            RETRIEVAL_QUERY rồi dùng cosine distance của pgvector để lấy Top 5.
          </s-paragraph>
        </s-banner>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
