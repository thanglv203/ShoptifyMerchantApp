import { createHash } from "node:crypto";

export type EmbeddingHashInput = {
  provider: string;
  model: string;
  dimension: number;
  version: number;
  text: string;
};

/** Include config metadata để đổi model/dimension/text-version luôn buộc re-embed. */
export function createEmbeddingDataHash(input: EmbeddingHashInput): string {
  const canonical = JSON.stringify([
    input.provider,
    input.model,
    input.dimension,
    input.version,
    input.text,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
