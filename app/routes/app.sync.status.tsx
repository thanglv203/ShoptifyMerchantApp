
import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../repositories/shop.repository";
import { getProductStats } from "../repositories/product.repository";
import { getLatestSyncJob } from "../repositories/sync-job.repository";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const [job, stats] = await Promise.all([
    getLatestSyncJob(shop.id),
    getProductStats(shop.id),
  ]);

  return { job, stats };
};
