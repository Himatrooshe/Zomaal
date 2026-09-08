import { ConflictException, NotFoundException } from '@nestjs/common';
import { ExpenseGroup, ExpensePaymentMethod, Prisma } from '@prisma/client';
import { ExpensesService } from './expenses.service';

function decimal(value: string) {
  return {
    toString: () => value,
    toFixed: (n: number) => Number(value).toFixed(n),
    plus: (other: unknown) =>
      decimal((Number(value) + Number((other as { toString(): string }).toString())).toString()),
  };
}

function build() {
  const prisma = {
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
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
  const service = new ExpensesService(prisma as never);
  return { service, prisma };
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
    prisma.expense.create.mockResolvedValue({
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
    });

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
});
