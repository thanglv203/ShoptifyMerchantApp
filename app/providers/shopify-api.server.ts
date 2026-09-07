
import { PermanentError, TransientError } from "../lib/errors";

/** Hàm graphql tối giản */
export type GraphqlFn = (
  query: string,
  options?: { variables?: Record<string, unknown> },
) => Promise<{ json(): Promise<unknown> }>;

export type ThrottleStatus = {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
};

export type CostInfo = {
  requestedQueryCost: number;
  actualQueryCost: number | null;
  throttleStatus: ThrottleStatus;
};

type GraphQLErrorItem = { message: string; extensions?: { code?: string } };

type GraphQLBody = {
  data?: unknown;
  errors?: GraphQLErrorItem[];
  extensions?: { cost?: CostInfo };
};

/** Logger tối giản để test không phải kéo pino vào. */
type LogLike = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  debug: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

export type ShopifyClientOptions = {
  /** Số lần thử lại tối đa cho lỗi transient (tổng số lần gọi = maxRetries + 1). */
  maxRetries?: number;
  /** Ngưỡng điểm an toàn: bucket dưới mức này thì chờ hồi trước khi trả kết quả. */
  safetyPoints?: number;
  /** Inject được trong test để không phải chờ thật. */
  sleep?: (ms: number) => Promise<void>;
  /** Inject được trong test để backoff deterministic. */
  random?: () => number;
};

/**
 * Exponential backoff + "equal jitter": nửa cố định + nửa ngẫu nhiên,
 * tránh nhiều worker cùng thức dậy một lúc (thundering herd).
 * attempt 0 → ~0.5–1s, 1 → ~1–2s, 2 → ~2–4s..., trần 30s.
 */
export function computeBackoffMs(
  attempt: number,
  opts?: { baseMs?: number; capMs?: number; random?: () => number },
): number {
  const base = opts?.baseMs ?? 1000;
  const cap = opts?.capMs ?? 30_000;
  const random = opts?.random ?? Math.random;
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.round(exp / 2 + random() * (exp / 2));
}

/**
 * Cần `neededPoints` điểm mà bucket chỉ còn `currentlyAvailable` →
 * thời gian chờ = phần thiếu / tốc độ hồi (điểm/giây).
 */
export function computeThrottleWaitMs(
  status: ThrottleStatus | undefined,
  neededPoints: number,
): number {
  if (!status) return 0;
  const deficit = neededPoints - status.currentlyAvailable;
  if (deficit <= 0) return 0;
  const rate = status.restoreRate > 0 ? status.restoreRate : 50;
  return Math.ceil((deficit / rate) * 1000);
}

/**
 * Phân loại lỗi bị NÉM (throw) từ tầng fetch/package (khác với errors[] trong body):
 * - Response-like có status: 429/5xx → transient; 4xx còn lại → permanent (token/scope/input).
 * - Lỗi mạng (ECONNRESET, fetch failed...) → transient.
 * - Không nhận diện được → transient (upsert idempotent nên retry thừa vô hại,
 *   còn bỏ sót retry một lỗi mạng thì mất dữ liệu sync).
 */
export function classifyThrownError(err: unknown): "transient" | "permanent" {
  const anyErr = err as { status?: unknown; response?: { status?: unknown } };
  const status =
    typeof anyErr?.status === "number"
      ? anyErr.status
      : typeof anyErr?.response?.status === "number"
        ? anyErr.response.status
        : undefined;
  if (typeof status === "number") {
    if (status === 429 || status >= 500) return "transient";
    return "permanent";
  }
  return "transient";
}

const PERMANENT_GRAPHQL_CODES = new Set([
  "MAX_COST_EXCEEDED", // query quá 1.000 điểm → phải giảm pageSize, retry vô nghĩa
  "ACCESS_DENIED", // thiếu scope / token sai
  "SHOP_INACTIVE",
]);

export class ShopifyClient {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly graphqlFn: GraphqlFn,
    private readonly log: LogLike,
    private readonly opts: ShopifyClientOptions = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get safetyPoints() {
    return this.opts.safetyPoints ?? 250;
  }

  async request<T = unknown>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<{ data: T; cost?: CostInfo }> {
    const maxRetries = this.opts.maxRetries ?? 5;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.graphqlFn(
          query,
          variables ? { variables } : undefined,
        );
        const body = (await res.json()) as GraphQLBody;
        const cost = body.extensions?.cost;
        const errors = body.errors ?? [];

        if (errors.length > 0) {
          // (1) THROTTLED: HTTP vẫn 200! Chờ đúng lượng bucket thiếu rồi thử lại.
          const throttled = errors.some(
            (e) => e.extensions?.code === "THROTTLED",
          );
          if (throttled) {
            const wait =
              computeThrottleWaitMs(
                cost?.throttleStatus,
                cost?.requestedQueryCost ?? this.safetyPoints,
              ) || computeBackoffMs(attempt, { random: this.opts.random });
            lastErr = new TransientError("Shopify GraphQL THROTTLED");
            this.log.warn({ attempt, waitMs: wait }, "THROTTLED — chờ rồi thử lại");
            await this.sleep(wait);
            continue;
          }

          const message = errors.map((e) => e.message).join("; ");
          const codes = errors.map((e) => e.extensions?.code).filter(Boolean);

          // (2) Lỗi vĩnh viễn đã biết → fail ngay.
          if (codes.some((c) => PERMANENT_GRAPHQL_CODES.has(c as string))) {
            throw new PermanentError(`GraphQL [${codes.join(",")}]: ${message}`);
          }
          // (3) Lỗi phía Shopify → transient.
          if (codes.every((c) => c === "INTERNAL_SERVER_ERROR") && codes.length > 0) {
            lastErr = new TransientError(`Shopify INTERNAL_SERVER_ERROR: ${message}`);
            const wait = computeBackoffMs(attempt, { random: this.opts.random });
            this.log.warn({ attempt, waitMs: wait }, "Shopify 5xx (GraphQL) — retry");
            await this.sleep(wait);
            continue;
          }
          // (4) Còn lại (sai field, sai syntax...) → bug của ta → permanent.
          throw new PermanentError(`GraphQL errors: ${message}`);
        }

        if (body.data === undefined || body.data === null) {
          throw new PermanentError("GraphQL response không có data");
        }

        // (5) Rate limit CHỦ ĐỘNG: bucket sắp cạn → chờ hồi trước khi cho caller đi tiếp.
        const proactiveWait = computeThrottleWaitMs(
          cost?.throttleStatus,
          this.safetyPoints,
        );
        if (proactiveWait > 0) {
          this.log.debug(
            {
              waitMs: proactiveWait,
              available: cost?.throttleStatus.currentlyAvailable,
            },
            "bucket sắp cạn — chờ hồi điểm",
          );
          await this.sleep(proactiveWait);
        }

        return { data: body.data as T, cost };
      } catch (err) {
        if (err instanceof PermanentError) throw err;
        if (classifyThrownError(err) === "permanent") {
          throw new PermanentError(
            `Shopify API lỗi không thể retry: ${String((err as Error)?.message ?? err)}`,
            { cause: err },
          );
        }
        lastErr = err;
        const wait = computeBackoffMs(attempt, { random: this.opts.random });
        this.log.warn(
          { attempt, waitMs: wait, err: String((err as Error)?.message ?? err) },
          "lỗi tạm thời khi gọi Shopify — retry",
        );
        await this.sleep(wait);
      }
    }

    throw new TransientError(
      `Shopify API vẫn lỗi sau ${maxRetries + 1} lần thử: ${String(
        (lastErr as Error)?.message ?? lastErr,
      )}`,
      { cause: lastErr },
    );
  }
}
