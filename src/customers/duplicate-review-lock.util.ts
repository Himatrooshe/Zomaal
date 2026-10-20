import type { Prisma } from '@prisma/client';

/** Shared by keep/cancel and dispatch claiming. Hold only for database work. */
export async function lockDuplicateReviewStore(
  tx: Prisma.TransactionClient,
  storeId: string,
) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'duplicate-review:' + storeId}, 0))::text`;
}
