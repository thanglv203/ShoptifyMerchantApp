
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../repositories/shop.repository";
import { listProducts } from "../repositories/product.repository";
import { formatMoney } from "../lib/money";

const PAGE_SIZE = 25;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;

  const result = await listProducts(shop.id, { page, pageSize: PAGE_SIZE });
  return result;
};

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN");
}

export default function ProductsPage() {
  const { items, total, page, pageCount } = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Products (${total})`}>
      <s-button slot="primary-action" href="/app" variant="secondary">
        Về Tổng quan
      </s-button>

      {items.length === 0 ? (
        <s-section>
          <s-banner tone="info" heading="Chưa có product nào trong database">
            <s-paragraph>
              Database đang trống.Bấm <s-text>Sync Products</s-text> ở
              trang Tổng quan để kéo toàn bộ product từ Shopify về đây.
            </s-paragraph>
          </s-banner>
        </s-section>
      ) : (
        <s-section>
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">Sản phẩm</s-table-header>
              <s-table-header>Vendor</s-table-header>
              <s-table-header>Loại</s-table-header>
              <s-table-header format="numeric">Giá từ</s-table-header>
              <s-table-header format="numeric">Variants</s-table-header>
              <s-table-header>Trạng thái</s-table-header>
              <s-table-header>Shopify updated</s-table-header>
              <s-table-header>Synced</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {items.map((p) => (
                <s-table-row key={p.id}>
                  <s-table-cell>
                    <s-stack direction="block" gap="small-300">
                      <s-text>{p.title}</s-text>
                      {p.tags.length > 0 ? (
                        <s-text color="subdued">{p.tags.join(", ")}</s-text>
                      ) : null}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{p.vendor ?? "—"}</s-table-cell>
                  <s-table-cell>{p.productType ?? "—"}</s-table-cell>
                  <s-table-cell>{formatMoney(p.price, p.currencyCode)}</s-table-cell>
                  <s-table-cell>{String(p.variantCount)}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={p.status === "ACTIVE" ? "success" : "neutral"}>
                      {p.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{formatDate(p.shopifyUpdatedAt)}</s-table-cell>
                  <s-table-cell>{formatDate(p.syncedAt)}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>

          <s-stack direction="inline" gap="base">
            <s-button
              href={`/app/products?page=${page - 1}`}
              {...(page <= 1 ? { disabled: true } : {})}
            >
              ← Trang trước
            </s-button>
            <s-text>
              Trang {page} / {pageCount}
            </s-text>
            <s-button
              href={`/app/products?page=${page + 1}`}
              {...(page >= pageCount ? { disabled: true } : {})}
            >
              Trang sau →
            </s-button>
          </s-stack>
        </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
