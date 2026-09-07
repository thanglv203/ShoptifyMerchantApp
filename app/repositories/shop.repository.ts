/**
 * Repository
 */
import prisma from "../db.server";


export async function getOrCreateShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    update: {},
    create: { domain },
  });
}

export async function getShopByDomain(domain: string) {
  return prisma.shop.findUnique({ where: { domain } });
}

export async function markShopSynced(shopId: string, at: Date = new Date()) {
  return prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncedAt: at },
  });
}
