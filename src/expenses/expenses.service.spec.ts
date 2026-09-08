import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ExpenseGroup, ExpensePaymentMethod, Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';

function foreignKeyConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: 'test',
  });
}

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function decimal(value: string) {
  return {
    toString: () => value,
    toFixed: (n: number) => Number(value).toFixed(n),
    plus: (other: unknown) =>
      decimal((Number(value) + Number((other as { toString(): string }).toString())).toString()),
  };
}

function build() {
  const prisma: any = {
    expenseCategory: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    expense: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    mediaAsset: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  // create()/update() run through $transaction(tx => ...) — reuse the same
  // mocked model methods as the "tx" client, the standard trick for testing
  // Prisma interactive transactions without a real DB.
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));

  const media = {
    uploadForStore: jest.fn(),
    streamForStore: jest.fn(),
    deleteAttachedAsset: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ExpensesService(prisma as never, media as never);
  return { service, prisma, media };
}

const ACCESS = { storeId: 'store-1', userId: 'owner-user', isOwner: true } as never;

const CATEGORY = {
  id: 'cat-1',
  name: 'Packaging',
  group: ExpenseGroup.OTHER,
  icon: null,
  color: null,
  isSystem: false,
};

const SALARY_CATEGORY = { ...CATEGORY, id: 'cat-salary', group: ExpenseGroup.SALARY, isSystem: true };

describe('ExpensesService', () => {
  it('rejects creating a category with a duplicate name in the store', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findUnique.mockResolvedValue(CATEGORY);

    await expect(
      service.createCategory('store-1', { name: 'Packaging' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expenseCategory.create).not.toHaveBeenCalled();
  });

  it('blocks deleting a system category', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue({ ...CATEGORY, isSystem: true });

    await expect(service.removeCategory('store-1', 'cat-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.expenseCategory.delete).not.toHaveBeenCalled();
  });

  it('blocks deleting a category that still has expenses recorded against it', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY);
    prisma.expense.count.mockResolvedValue(3);

    await expect(service.removeCategory('store-1', 'cat-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.expenseCategory.delete).not.toHaveBeenCalled();
  });

  it('404s creating an expense against a category from another store', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(null);

    await expect(
      service.create(ACCESS, {
        title: 'x',
        amount: '10.00',
        paymentMethod: ExpensePaymentMethod.CASH,
        spentAt: '2026-09-01',
        categoryId: 'cat-elsewhere',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects creating an expense directly under a SALARY-group category', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(SALARY_CATEGORY);

    await expect(
      service.create(ACCESS, {
        title: 'Manual salary attempt',
        amount: '10.00',
        paymentMethod: ExpensePaymentMethod.CASH,
        spentAt: '2026-09-01',
        categoryId: 'cat-salary',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });

  it('creates a normal expense and stamps createdByUserId', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY);
    const created = {
      id: 'exp-1',
      title: 'Bubble wrap',
      amount: decimal('99.50'),
      paymentMethod: ExpensePaymentMethod.CASH,
      spentAt: new Date('2026-09-01'),
      notes: null,
      receiptUrl: null,
      category: CATEGORY,
      staffMemberId: null,
      createdAt: new Date('2026-09-01'),
    };
    prisma.expense.create.mockResolvedValue(created);
    prisma.expense.findUniqueOrThrow.mockResolvedValue(created);

    const result = await service.create(ACCESS, {
      title: 'Bubble wrap',
      amount: '99.50',
      paymentMethod: ExpensePaymentMethod.CASH,
      spentAt: '2026-09-01',
      categoryId: 'cat-1',
    });

    expect(result.isSalaryGenerated).toBe(false);
    expect(prisma.expense.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdByUserId: 'owner-user', storeId: 'store-1' }),
      }),
    );
  });

  it('blocks editing an expense that was generated from a salary payment', async () => {
    const { service, prisma } = build();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      staffMemberId: 'staff-1',
      categoryId: 'cat-salary',
      category: SALARY_CATEGORY,
    });

    await expect(
      service.update(ACCESS, 'exp-1', { title: 'renamed' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expense.update).not.toHaveBeenCalled();
  });

  it('blocks deleting an expense that was generated from a salary payment', async () => {
    const { service, prisma } = build();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      staffMemberId: 'staff-1',
      category: SALARY_CATEGORY,
    });

    await expect(service.remove(ACCESS, 'exp-1')).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expense.delete).not.toHaveBeenCalled();
  });

  it('summary sums totals per group and a grand total across all five groups', async () => {
    const { service, prisma } = build();
    prisma.expense.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('100'), category: { group: ExpenseGroup.SHIPPING } },
      { amount: new Prisma.Decimal('50'), category: { group: ExpenseGroup.SHIPPING } },
      { amount: new Prisma.Decimal('25'), category: { group: ExpenseGroup.OTHER } },
    ]);

    const result = await service.summary('store-1', {});

    expect(result.totalAmount).toBe('175.00');
    expect(result.byGroup).toEqual(
      expect.arrayContaining([
        { group: ExpenseGroup.SHIPPING, total: '150.00' },
        { group: ExpenseGroup.OTHER, total: '25.00' },
        { group: ExpenseGroup.ADS, total: '0.00' },
        { group: ExpenseGroup.SALARY, total: '0.00' },
        { group: ExpenseGroup.PURCHASES, total: '0.00' },
      ]),
    );
  });

  it('rejects creating a custom category directly in the SALARY group', async () => {
    const { service, prisma } = build();

    await expect(
      service.createCategory('store-1', { name: 'My Bonuses', group: ExpenseGroup.SALARY }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expenseCategory.create).not.toHaveBeenCalled();
    // Must reject before even checking name uniqueness against the DB.
    expect(prisma.expenseCategory.findUnique).not.toHaveBeenCalled();
  });

  it('rejects reassigning an existing category into the SALARY group', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY); // group: OTHER

    await expect(
      service.updateCategory('store-1', 'cat-1', { group: ExpenseGroup.SALARY }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.expenseCategory.update).not.toHaveBeenCalled();
  });

  it('allows a no-op update to the seeded SALARY category itself', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(SALARY_CATEGORY);
    prisma.expenseCategory.update.mockResolvedValue(SALARY_CATEGORY);

    await expect(
      service.updateCategory('store-1', 'cat-salary', { group: ExpenseGroup.SALARY, color: '#000' }),
    ).resolves.toBeDefined();
    expect(prisma.expenseCategory.update).toHaveBeenCalled();
  });

  it('converts a racing category-name INSERT into a clean 409, not a raw 500', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findUnique.mockResolvedValue(null);
    prisma.expenseCategory.create.mockRejectedValue(uniqueConstraintError());

    await expect(
      service.createCategory('store-1', { name: 'Packaging' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('converts a racing concurrent-expense-insert-during-delete into a clean 409, not a raw 500', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY);
    prisma.expense.count.mockResolvedValue(0); // pre-check saw nothing in use
    prisma.expenseCategory.delete.mockRejectedValue(foreignKeyConstraintError()); // but lost the race

    await expect(service.removeCategory('store-1', 'cat-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('attaches a receiptAssetId to the new expense and points receiptUrl at the receipts route', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY);
    const created = { id: 'exp-1' };
    prisma.expense.create.mockResolvedValue(created);
    prisma.expense.findUniqueOrThrow.mockResolvedValue({
      ...created,
      title: 'x',
      amount: decimal('10'),
      paymentMethod: ExpensePaymentMethod.CASH,
      spentAt: new Date(),
      notes: null,
      receiptUrl: '/expenses/receipts/asset-1',
      category: CATEGORY,
      staffMemberId: null,
      createdAt: new Date(),
    });

    const result = await service.create(ACCESS, {
      title: 'x',
      amount: '10.00',
      paymentMethod: ExpensePaymentMethod.CASH,
      spentAt: new Date().toISOString(),
      categoryId: 'cat-1',
      receiptAssetId: 'asset-1',
    });

    expect(result.receiptUrl).toBe('/expenses/receipts/asset-1');
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'asset-1', storeId: 'store-1', purpose: 'RECEIPT' }),
        data: expect.objectContaining({ status: 'ATTACHED', expenseId: 'exp-1' }),
      }),
    );
  });

  it('rejects create when the receiptAssetId does not resolve to an available upload', async () => {
    const { service, prisma } = build();
    prisma.expenseCategory.findFirst.mockResolvedValue(CATEGORY);
    prisma.expense.create.mockResolvedValue({ id: 'exp-1' });
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 }); // already used / expired / wrong store

    await expect(
      service.create(ACCESS, {
        title: 'x',
        amount: '10.00',
        paymentMethod: ExpensePaymentMethod.CASH,
        spentAt: new Date().toISOString(),
        categoryId: 'cat-1',
        receiptAssetId: 'stale-asset',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('replacing a receipt on update frees the old one before attaching the new one', async () => {
    const { service, prisma, media } = build();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      staffMemberId: null,
      categoryId: 'cat-1',
      category: CATEGORY,
    });
    prisma.mediaAsset.findUnique.mockResolvedValue({ id: 'old-asset' });
    prisma.expense.update.mockResolvedValue({
      id: 'exp-1',
      title: 'x',
      amount: decimal('10'),
      paymentMethod: ExpensePaymentMethod.CASH,
      spentAt: new Date(),
      notes: null,
      receiptUrl: '/expenses/receipts/new-asset',
      category: CATEGORY,
      staffMemberId: null,
      createdAt: new Date(),
    });

    await service.update(ACCESS, 'exp-1', { receiptAssetId: 'new-asset' });

    expect(media.deleteAttachedAsset).toHaveBeenCalledWith('old-asset');
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ expenseId: 'exp-1' }) }),
    );
  });

  it('deleting an expense with a linked receipt cleans it up (best-effort)', async () => {
    const { service, prisma, media } = build();
    prisma.expense.findFirst.mockResolvedValue({
      id: 'exp-1',
      staffMemberId: null,
      category: CATEGORY,
    });
    prisma.mediaAsset.findUnique.mockResolvedValue({ id: 'receipt-1' });

    await service.remove(ACCESS, 'exp-1');

    expect(media.deleteAttachedAsset).toHaveBeenCalledWith('receipt-1');
    expect(prisma.expense.delete).toHaveBeenCalledWith({ where: { id: 'exp-1' } });
  });

  it('trend: fills every month in range, including ones with zero activity', async () => {
    const { service, prisma } = build();
    const now = new Date('2026-09-15T00:00:00.000Z');
    prisma.expense.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('100'), spentAt: new Date('2026-08-05T00:00:00.000Z') },
      { amount: new Prisma.Decimal('50'), spentAt: new Date('2026-08-20T00:00:00.000Z') },
      // September deliberately has nothing.
    ]);
    jest.useFakeTimers().setSystemTime(now);

    const result = await service.trend('store-1', { months: 3 });

    expect(result.points).toEqual([
      { month: '2026-07', total: '0.00' },
      { month: '2026-08', total: '150.00' },
      { month: '2026-09', total: '0.00' },
    ]);
    // Last month (Sep, 0) vs prior (Aug, 150) -> down, not null (150 wasn't zero).
    expect(result.trend).toEqual({ changePercent: -100, direction: 'down' });
    jest.useRealTimers();
  });
});
