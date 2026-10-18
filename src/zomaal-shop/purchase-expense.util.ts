import {
  ExpenseGroup,
  ExpensePaymentMethod,
  Prisma,
  ShopPaymentMethod,
} from '@prisma/client';

/** The store's PURCHASES expense category, created for stores that predate the seeds. */
export async function purchaseCategoryId(
  tx: Prisma.TransactionClient,
  storeId: string,
): Promise<string> {
  const existing = await tx.expenseCategory.findFirst({
    where: { storeId, group: ExpenseGroup.PURCHASES },
    orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.expenseCategory.create({
    data: {
      storeId,
      name: 'Purchases',
      group: ExpenseGroup.PURCHASES,
      isSystem: true,
    },
    select: { id: true },
  });
  return created.id;
}

export function purchaseExpenseTitle(productName: string): string {
  return `Purchase — ${productName}`;
}

export function shopPaymentToExpense(
  method: ShopPaymentMethod,
): ExpensePaymentMethod {
  return method === ShopPaymentMethod.ONLINE
    ? ExpensePaymentMethod.BANK
    : ExpensePaymentMethod.CASH;
}

/** Creates the "Purchase costs" expense a purchase owns. */
export async function createPurchaseExpense(
  tx: Prisma.TransactionClient,
  input: {
    storeId: string;
    productName: string;
    amount: Prisma.Decimal;
    paymentMethod: ExpensePaymentMethod;
    spentAt: Date;
    notes: string | null;
    createdByUserId: string | null;
    receiptUrl?: string | null;
  },
) {
  return tx.expense.create({
    data: {
      storeId: input.storeId,
      categoryId: await purchaseCategoryId(tx, input.storeId),
      title: purchaseExpenseTitle(input.productName),
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      spentAt: input.spentAt,
      notes: input.notes,
      createdByUserId: input.createdByUserId,
      receiptUrl: input.receiptUrl ?? null,
    },
    select: { id: true },
  });
}
