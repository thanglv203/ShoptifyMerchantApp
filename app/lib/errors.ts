/**
 * Phân loại lỗi — 
 * - TransientError: lỗi TẠM THỜI (rate limit, 5xx, đứt mạng) → ĐƯỢC PHÉP retry.
 * - PermanentError: lỗi VĨNH VIỄN (sai input, thiếu scope, query quá cost) → KHÔNG retry
 */

export class TransientError extends Error {
  readonly kind = "transient" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientError";
  }
}

export class PermanentError extends Error {
  readonly kind = "permanent" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentError";
  }
}

export function isTransientError(err: unknown): err is TransientError {
  return err instanceof TransientError;
}

export function isPermanentError(err: unknown): err is PermanentError {
  return err instanceof PermanentError;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
