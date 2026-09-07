import { Prisma } from "@prisma/client";
import prisma from "../db.server";

export type ClaimWebhookEventInput = {
  webhookId: string;
  eventId?: string | null;
  shopDomain: string;
  topic: string;
  resourceId?: string | null;
  shopifyUpdatedAt?: string | null;
};

export type ClaimWebhookEventResult =
  | { claimed: true; eventId: string; retried: boolean }
  | { claimed: false; eventId: string; status: string };

function optionalBigInt(value: string | null | undefined): bigint | null {
  return value ? BigInt(value) : null;
}

function optionalDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Ghi delivery trước khi xử lý. UNIQUE(webhookId) chống hai delivery đồng thời.
 * Event FAILED được claim lại khi Shopify retry; event đang chạy/đã xong trả duplicate.
 */
export async function claimWebhookEvent(
  input: ClaimWebhookEventInput,
): Promise<ClaimWebhookEventResult> {
  const data = {
    webhookId: input.webhookId,
    eventId: input.eventId ?? null,
    shopDomain: input.shopDomain,
    topic: input.topic,
    resourceId: optionalBigInt(input.resourceId),
    shopifyUpdatedAt: optionalDate(input.shopifyUpdatedAt),
  };

  try {
    const event = await prisma.webhookEvent.create({
      data,
      select: { id: true },
    });
    return { claimed: true, eventId: event.id, retried: false };
  } catch (error) {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== "P2002"
    ) {
      throw error;
    }

    const existing = await prisma.webhookEvent.findUnique({
      where: { webhookId: input.webhookId },
      select: { id: true, status: true },
    });
    if (!existing) throw error;

    if (existing.status === "FAILED") {
      const reclaimed = await prisma.webhookEvent.updateMany({
        where: { id: existing.id, status: "FAILED" },
        data: {
          status: "RECEIVED",
          error: null,
          processedAt: null,
          receivedAt: new Date(),
          ...data,
        },
      });
      if (reclaimed.count === 1) {
        return { claimed: true, eventId: existing.id, retried: true };
      }
    }

    return { claimed: false, eventId: existing.id, status: existing.status };
  }
}

export async function completeWebhookEvent(
  eventId: string,
  input: { shopId: string; skipped?: boolean },
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: {
      shopId: input.shopId,
      status: input.skipped ? "SKIPPED" : "PROCESSED",
      error: null,
      processedAt: new Date(),
    },
  });
}

export async function skipWebhookEvent(
  eventId: string,
  reason: string,
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: "SKIPPED", error: reason, processedAt: new Date() },
  });
}

export async function failWebhookEvent(
  eventId: string,
  error: string,
): Promise<void> {
  await prisma.webhookEvent.update({
    where: { id: eventId },
    data: { status: "FAILED", error, processedAt: new Date() },
  });
}
