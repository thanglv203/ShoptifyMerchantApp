export type JobPayloads = {
  "sync-products": { jobId: string };
  "embed-product": { productId: string; shopId: string };
  "embed-shop": { shopId: string };
};

export type JobName = keyof JobPayloads;

export function jobSingletonKey<N extends JobName>(
  name: N,
  payload: JobPayloads[N],
): string {
  if (name === "sync-products")
    return (payload as JobPayloads["sync-products"]).jobId;
  if (name === "embed-product")
    return (payload as JobPayloads["embed-product"]).productId;
  return (payload as JobPayloads["embed-shop"]).shopId;
}
