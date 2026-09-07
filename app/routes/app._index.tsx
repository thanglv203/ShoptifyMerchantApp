
import { useEffect, useRef } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../repositories/shop.repository";
import { getProductStats } from "../repositories/product.repository";
import {
  createSyncJob,
  getLatestSyncJob,
  resumeSyncJob,
  SyncAlreadyRunningError,
} from "../repositories/sync-job.repository";
import { jobQueue } from "../jobs/queue.server";
import { PermanentError } from "../lib/errors";
import type { loader as syncStatusLoader } from "./app.sync.status";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const [stats, latestJob] = await Promise.all([
    getProductStats(shop.id),
    getLatestSyncJob(shop.id),
  ]);

  return {
    shopDomain: shop.domain,
    lastSyncedAt: shop.lastSyncedAt ? shop.lastSyncedAt.toISOString() : null,
    stats,
    latestJob,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent === "start-sync") {
      const job = await createSyncJob(shop.id);
      await jobQueue.enqueue("sync-products", { jobId: job.id });
      return { ok: true as const, jobId: job.id };
    }
    if (intent === "resume-sync") {
      const jobId = String(form.get("jobId") ?? "");
      const job = await resumeSyncJob(jobId, shop.id);
      await jobQueue.enqueue("sync-products", { jobId: job.id });
      return { ok: true as const, jobId: job.id };
    }
    return { ok: false as const, error: `Intent không hợp lệ: ${intent}` };
  } catch (err) {
    // Lỗi "đã có sync chạy" / "job không resume được" là tình huống bình thường của UI,
    // trả message cho banner thay vì ném 500.
    if (err instanceof SyncAlreadyRunningError || err instanceof PermanentError) {
      return { ok: false as const, error: err.message };
    }
    throw err;
  }
};

function formatDate(iso: string | null) {
  if (!iso) return "Chưa có";
  return new Date(iso).toLocaleString("vi-VN");
}

const ACTIVE_STATUSES = ["PENDING", "RUNNING"];

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const actionFetcher = useFetcher<typeof action>();
  const statusFetcher = useFetcher<typeof syncStatusLoader>();
  const shopify = useAppBridge();

  // Ưu tiên dữ liệu poll mới nhất; fallback dữ liệu loader lúc load trang.
  const job = statusFetcher.data?.job ?? loaderData.latestJob;
  const stats = statusFetcher.data?.stats ?? loaderData.stats;
  const isSyncActive = !!job && ACTIVE_STATUSES.includes(job.status);
  const isSubmitting = actionFetcher.state !== "idle";

  // Poll tiến độ mỗi 2s khi có job đang chạy.
  useEffect(() => {
    if (!isSyncActive) return;
    const id = setInterval(() => {
      statusFetcher.load("/app/sync/status");
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSyncActive]);

  // Sau khi bấm Sync/Resume thành công → load trạng thái ngay (không chờ 2s).
  useEffect(() => {
    if (actionFetcher.data?.ok) statusFetcher.load("/app/sync/status");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFetcher.data]);

  // Toast khi job chuyển sang COMPLETED.
  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    const current = job?.status ?? null;
    if (
      prevStatus.current &&
      ACTIVE_STATUSES.includes(prevStatus.current) &&
      current === "COMPLETED"
    ) {
      shopify.toast.show(`Sync hoàn tất: ${job?.processedCount ?? 0} products`);
    }
    prevStatus.current = current;
  }, [job?.status, job?.processedCount, shopify]);

  const percent =
    job && job.totalCount
      ? Math.min(100, Math.round((job.processedCount / job.totalCount) * 100))
      : null;

  const startSync = () =>
    actionFetcher.submit({ intent: "start-sync" }, { method: "post" });
  const resumeSync = () =>
    job &&
    actionFetcher.submit(
      { intent: "resume-sync", jobId: job.id },
      { method: "post" },
    );

  return (
    <s-page heading="Product Vector Search">
      <s-button
        slot="primary-action"
        onClick={startSync}
        {...(isSubmitting || isSyncActive ? { loading: true } : {})}
      >
        Sync Products
      </s-button>

      {actionFetcher.data && actionFetcher.data.ok === false ? (
        <s-banner tone="warning" heading="Không bắt đầu được sync">
          <s-paragraph>{actionFetcher.data.error}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Trạng thái dữ liệu">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            <s-text>Shop: </s-text>
            <s-text>{loaderData.shopDomain}</s-text>
          </s-paragraph>
          <s-paragraph>
            <s-text>Products trong DB: </s-text>
            <s-badge tone="info">{String(stats.active)}</s-badge>
            <s-text> · Đã xoá (soft delete): </s-text>
            <s-badge tone="neutral">{String(stats.deleted)}</s-badge>
          </s-paragraph>
          <s-paragraph>
            <s-text>Lần sync gần nhất: </s-text>
            <s-text>
              {formatDate(loaderData.lastSyncedAt ?? stats.lastSyncedAt)}
            </s-text>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Sync job">
        {job ? (
          <s-stack direction="block" gap="base">
            <s-paragraph>
              <s-badge
                tone={
                  job.status === "COMPLETED"
                    ? "success"
                    : job.status === "FAILED"
                      ? "critical"
                      : "info"
                }
              >
                {job.status}
              </s-badge>
              <s-text> · Chế độ: {job.mode}</s-text>
              <s-text> · Tạo lúc: {formatDate(job.createdAt)}</s-text>
            </s-paragraph>

            <s-paragraph>
              {isSyncActive ? <s-spinner size="base" /> : null}
              <s-text>
                {" "}
                Tiến độ: {job.processedCount}
                {job.totalCount !== null ? ` / ${job.totalCount}` : ""}
                {percent !== null ? ` (${percent}%)` : ""}
              </s-text>
            </s-paragraph>

            {job.status === "FAILED" ? (
              <s-banner tone="critical" heading="Sync bị lỗi giữa chừng">
                <s-paragraph>{job.error ?? "Không rõ nguyên nhân"}</s-paragraph>
                <s-paragraph>
                  Dữ liệu đã sync vẫn còn nguyên; cursor đã được checkpoint
                  {job.cursor ? " — Resume sẽ chạy tiếp từ trang cuối." : "."}
                </s-paragraph>
                <s-button
                  onClick={resumeSync}
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  Resume sync
                </s-button>
              </s-banner>
            ) : null}

            {job.status === "COMPLETED" ? (
              <s-banner tone="success" heading="Sync hoàn tất">
                <s-paragraph>
                  Đã xử lý {job.processedCount} products. Xem tại trang{" "}
                  <s-link href="/app/products">Products</s-link>.
                </s-paragraph>
              </s-banner>
            ) : null}
          </s-stack>
        ) : (
          <s-banner tone="info" heading="Chưa có lần sync nào">
            <s-paragraph>
              Bấm <s-text>Sync Products</s-text> để kéo toàn bộ product từ
              Shopify về database (cursor pagination, checkpoint từng trang).
            </s-paragraph>
          </s-banner>
        )}
      </s-section>

      <s-section slot="aside" heading="Cách sync hoạt động">
        <s-unordered-list>
          <s-list-item>Nút Sync tạo SyncJob rồi trả về ngay (job chạy nền)</s-list-item>
          <s-list-item>Cursor pagination theo updated_at, checkpoint mỗi trang</s-list-item>
          <s-list-item>Upsert theo (shopId, shopifyId) — chạy lại không tạo trùng</s-list-item>
          <s-list-item>Đọc throttleStatus, tự chờ khi bucket cạn, retry THROTTLED</s-list-item>
          <s-list-item>Lỗi giữa chừng → FAILED + Resume từ checkpoint</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
