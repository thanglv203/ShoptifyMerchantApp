import { PermanentError } from "../lib/errors";

export const EMBEDDING_DIMENSION = 768;

export type EmbeddingTaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

export interface EmbeddingProvider {
  readonly provider: string;
  readonly model: string;
  readonly dimension: number;

  embed(text: string, taskType: EmbeddingTaskType): Promise<number[]>;
}

export function validateEmbeddingVector(
  vector: unknown,
  expectedDimension = EMBEDDING_DIMENSION,
): number[] {
  if (!Array.isArray(vector) || vector.length !== expectedDimension) {
    throw new PermanentError(
      `Embedding phải có đúng ${expectedDimension} chiều, nhận ${Array.isArray(vector) ? vector.length : "không phải array"}`,
    );
  }
  const values = vector.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value))) {
    throw new PermanentError("Embedding chứa giá trị không phải số hữu hạn");
  }
  return values;
}

export function normalizeEmbeddingVector(
  vector: unknown,
  expectedDimension = EMBEDDING_DIMENSION,
): number[] {
  const values = validateEmbeddingVector(vector, expectedDimension);
  const magnitude = Math.sqrt(
    values.reduce((sum, value) => sum + value * value, 0),
  );
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new PermanentError("Embedding có độ dài bằng 0");
  }
  return values.map((value) => value / magnitude);
}
