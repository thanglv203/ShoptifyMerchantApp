/**
 * SyncJobRepository — state machine của một lần Sync Products.
 */
import { Prisma, type SyncJob } from "@prisma/client";
import prisma from "../db.server";
import { PermanentError } from "../lib/errors";

export class SyncAlreadyRunningError extends Error {
  constructor() {
    super("Shop này đang có một sync chạy — chờ xong hoặc resume job FAILED.");
    this.name = "SyncAlreadyRunningError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}


export type SyncJobSummary = {
  id: string;
  status: string;
  mode: string;
  processedCount: number;
  totalCount: number | null;
  cursor: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function toSummary(job: SyncJob): SyncJobSummary {
  return {
    id: job.id,
    status: job.status,
    mode: job.mode,
    processedCount: job.processedCount,
    totalCount: job.totalCount,
    cursor: job.cursor,
    error: job.error,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
    createdAt: job.createdAt.toISOString(),
  };
}

export async function getLatestSyncJob(
  shopId: string,
): Promise<SyncJobSummary | null> {
  const job = await prisma.syncJob.findFirst({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
  return job ? toSummary(job) : null;
}


export async function getSyncJobRecord(jobId: string): Promise<SyncJob | null> {
  return prisma.syncJob.findUnique({ where: { id: jobId } });
}


/** Tạo job FULL sync mới. Ném SyncAlreadyRunningError nếu shop đang có job chạy. */
export async function createSyncJob(shopId: string): Promise<SyncJobSummary> {
  try {
    const job = await prisma.syncJob.create({
      data: { shopId, status: "PENDING", mode: "FULL", activeLockKey: shopId },
    });
    return toSummary(job);
  } catch (err) {
    if (isUniqueViolation(err)) throw new SyncAlreadyRunningError();
    throw err;
  }
}

/**
 * Resume một job FAILED của đúng shop này: giữ nguyên cursor + processedCount
 */
export async function resumeSyncJob(
  jobId: string,
  shopId: string,
): Promise<SyncJobSummary> {
  const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job || job.shopId !== shopId) {
    throw new PermanentError("Không tìm thấy sync job của shop này.");
  }
  if (job.status !== "FAILED") {
    throw new PermanentError(`Job đang ở trạng thái ${job.status}, chỉ resume được job FAILED.`);
  }
  try {
    const updated = await prisma.syncJob.update({
      where: { id: jobId },
      data: {
        status: "PENDING",
        activeLockKey: shopId,
        error: null,
        finishedAt: null,
      },
    });
    return toSummary(updated);
  } catch (err) {
    if (isUniqueViolation(err)) throw new SyncAlreadyRunningError();
    throw err;
  }
}

export async function markSyncJobRunning(jobId: string): Promise<void> {
  const job = await prisma.syncJob.findUnique({
    where: { id: jobId },
    select: { startedAt: true },
  });
  await prisma.syncJob.update({
    where: { id: jobId },
    data: { status: "RUNNING", startedAt: job?.startedAt ?? new Date() },
  });
}

export async function setSyncJobTotal(jobId: string, total: number): Promise<void> {
  await prisma.syncJob.update({ where: { id: jobId }, data: { totalCount: total } });
}

/**
 * Checkpoint sau MỖI trang: lưu endCursor + cộng dồn processedCount, commit ngay.
 * Đây là cơ chế resume: crash ở trang N thì lần sau chạy tiếp từ cursor trang N-1.
 */
export async function checkpointSyncJob(
  jobId: string,
  args: { cursor: string | null; processed: number },
): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      cursor: args.cursor,
      processedCount: { increment: args.processed },
    },
  });
}

export async function completeSyncJob(jobId: string): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      activeLockKey: null, // nhả khoá
      error: null,
    },
  });
}

export async function failSyncJob(jobId: string, message: string): Promise<void> {
  await prisma.syncJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      activeLockKey: null, // nhả khoá để có thể resume/tạo job mới
      error: message.slice(0, 2000),
    },
  });
}
