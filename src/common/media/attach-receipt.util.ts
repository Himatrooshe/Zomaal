import { BadRequestException } from '@nestjs/common';
import { MediaAssetPurpose, MediaAssetStatus, Prisma } from '@prisma/client';

/** Route the receipt-content response points at — served by ExpensesController. */
export function receiptPreviewPath(assetId: string): string {
  return `/expenses/receipts/${assetId}`;
}

/**
 * Attaches a previously-uploaded RECEIPT media asset (POST /expenses/receipts)
 * to the Expense or StaffSalaryPayment that just referenced it — flips
 * TEMPORARY -> ATTACHED, clears the 24h TTL, and sets the owning FK.
 *
 * Scoped by storeId, purpose, and TEMPORARY-and-unexpired so a caller can
 * never attach another store's upload, someone else's already-attached
 * receipt, or one that already expired.
 */
export async function attachReceipt(
  tx: Prisma.TransactionClient,
  storeId: string,
  assetId: string,
  target: { expenseId: string } | { salaryPaymentId: string },
): Promise<void> {
  const result = await tx.mediaAsset.updateMany({
    where: {
      id: assetId,
      storeId,
      purpose: MediaAssetPurpose.RECEIPT,
      status: MediaAssetStatus.TEMPORARY,
      expiresAt: { gt: new Date() },
    },
    data: {
      status: MediaAssetStatus.ATTACHED,
      expiresAt: null,
      ...target,
    },
  });

  if (result.count === 0) {
    throw new BadRequestException(
      'Receipt not found, already used, or expired. Upload it again.',
    );
  }
}
