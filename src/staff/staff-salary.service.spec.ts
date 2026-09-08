import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  StaffStatus,
} from '@prisma/client';
import { StaffSalaryService, advance } from './staff-salary.service';

const STORE_ACCESS = { storeId: 'store-1', isOwner: true };

function decimal(value: string) {
  // Minimal stand-in for Prisma.Decimal — only the methods this service calls.
  return {
    toString: () => value,
    toFixed: (n: number) => Number(value).toFixed(n),
    plus: (other: unknown) =>
      decimal((Number(value) + Number((other as { toString(): string }).toString())).toString()),
  };
}

function build() {
  const prisma: any = {
    staffMember: { findFirst: jest.fn(), findMany: jest.fn() },
    staffSalaryProfile: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    staffSalaryPayment: { findMany: jest.fn(), count: jest.fn(), create: jest.fn() },
    expenseCategory: { findFirst: jest.fn(), create: jest.fn() },
    mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  // createPayments runs through $transaction(tx => ...) — reuse the same
  // mocked model methods as the "tx" client (standard trick for testing
  // Prisma interactive transactions without a real DB).
  prisma.$transaction = jest.fn((cb: (tx: unknown) => unknown) => cb(prisma));

  const storeAccess = { requireOwner: jest.fn().mockResolvedValue(STORE_ACCESS) };
  const service = new StaffSalaryService(prisma as never, storeAccess as never);
  return { service, prisma, storeAccess };
}

describe('StaffSalaryService', () => {
  it('404s a salary profile lookup for a staff member outside this store', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue(null);

    await expect(service.getProfile('owner-user', 'staff-x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('setProfile: new AUTOMATIC profile uses startDate as the first nextPaymentDate', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue({ id: 'staff-1' });
    prisma.staffSalaryProfile.findUnique.mockResolvedValue(null);
    prisma.staffSalaryProfile.upsert.mockImplementation((args: any) => ({ ...args.create, baseSalary: decimal(args.create.baseSalary) }));

    const result = await service.setProfile('owner-user', 'staff-1', {
      baseSalary: '3000',
      frequency: SalaryFrequency.MONTHLY,
      paymentMethod: SalaryPaymentMethod.CASH,
      expenseHandling: SalaryExpenseHandling.AUTOMATIC,
      startDate: '2026-01-31T00:00:00.000Z',
    });

    expect(result.nextPaymentDate).toBe('2026-01-31T00:00:00.000Z');
  });

  it('setProfile: editing an unrelated field on an already-AUTOMATIC profile preserves the running schedule', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue({ id: 'staff-1' });
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      startDate: new Date('2026-01-31T00:00:00.000Z'),
      nextPaymentDate: new Date('2026-06-30T00:00:00.000Z'), // schedule has already advanced past startDate
    });
    prisma.staffSalaryProfile.upsert.mockImplementation((args: any) => ({ ...args.update, baseSalary: decimal(args.update.baseSalary) }));

    const result = await service.setProfile('owner-user', 'staff-1', {
      baseSalary: '3500', // only the amount changed
      frequency: SalaryFrequency.MONTHLY,
      paymentMethod: SalaryPaymentMethod.CASH,
      expenseHandling: SalaryExpenseHandling.AUTOMATIC,
      startDate: '2026-01-31T00:00:00.000Z', // unchanged
    });

    // Must NOT reset to startDate — that would silently rewind an in-flight schedule.
    expect(result.nextPaymentDate).toBe('2026-06-30T00:00:00.000Z');
  });

  it('setProfile: deliberately changing startDate on an AUTOMATIC profile resets the schedule to it', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue({ id: 'staff-1' });
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      startDate: new Date('2026-01-31T00:00:00.000Z'),
      nextPaymentDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    prisma.staffSalaryProfile.upsert.mockImplementation((args: any) => ({ ...args.update, baseSalary: decimal(args.update.baseSalary) }));

    const result = await service.setProfile('owner-user', 'staff-1', {
      baseSalary: '3000',
      frequency: SalaryFrequency.MONTHLY,
      paymentMethod: SalaryPaymentMethod.CASH,
      expenseHandling: SalaryExpenseHandling.AUTOMATIC,
      startDate: '2026-08-01T00:00:00.000Z', // deliberately moved
    });

    expect(result.nextPaymentDate).toBe('2026-08-01T00:00:00.000Z');
  });

  it('setProfile: switching to MANUAL clears the schedule', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue({ id: 'staff-1' });
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      startDate: new Date('2026-01-31T00:00:00.000Z'),
      nextPaymentDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    prisma.staffSalaryProfile.upsert.mockImplementation((args: any) => ({ ...args.update, baseSalary: decimal(args.update.baseSalary) }));

    const result = await service.setProfile('owner-user', 'staff-1', {
      baseSalary: '3000',
      frequency: SalaryFrequency.MONTHLY,
      paymentMethod: SalaryPaymentMethod.CASH,
      expenseHandling: SalaryExpenseHandling.MANUAL,
      startDate: '2026-01-31T00:00:00.000Z',
    });

    expect(result.nextPaymentDate).toBeNull();
  });

  it('blocks a manual payment for every staff member whose profile is AUTOMATIC', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        name: 'Auto Staff',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.AUTOMATIC, baseSalary: decimal('100') },
      },
    ]);

    await expect(
      service.createPayments('owner-user', {
        staffMemberIds: ['staff-1'],
        paymentDate: '2026-09-01',
        paymentMethod: SalaryPaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });

  it('404s a bulk payment when a staffMemberId does not belong to this store', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([]); // none found for either id

    await expect(
      service.createPayments('owner-user', {
        staffMemberIds: ['staff-missing'],
        paymentDate: '2026-09-01',
        paymentMethod: SalaryPaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires an explicit amount when a staff member has no salary profile set', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      { id: 'staff-1', name: 'No Profile Staff', salaryProfile: null },
    ]);

    await expect(
      service.createPayments('owner-user', {
        staffMemberIds: ['staff-1'],
        paymentDate: '2026-09-01',
        paymentMethod: SalaryPaymentMethod.CASH,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates a manual payment linked to a generated expense for a MANUAL staff member', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        name: 'Manual Staff',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.MANUAL, baseSalary: decimal('3000') },
      },
    ]);
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-salary' });
    prisma.staffSalaryPayment.create.mockResolvedValue({
      id: 'payment-1',
      staffMemberId: 'staff-1',
      amount: decimal('3000'),
      paymentDate: new Date('2026-09-01'),
      paidAt: new Date('2026-09-01'),
      paymentMethod: SalaryPaymentMethod.CASH,
      status: 'PAID',
      notes: null,
      receiptUrl: null,
    });

    const result = await service.createPayments('owner-user', {
      staffMemberIds: ['staff-1'],
      paymentDate: '2026-09-01',
      paymentMethod: SalaryPaymentMethod.CASH,
    });

    expect(result.payments).toHaveLength(1);
    expect(result.payments[0].amount).toBe('3000.00');
    const createArgs = prisma.staffSalaryPayment.create.mock.calls[0][0];
    expect(createArgs.data.expense.create.storeId).toBe('store-1');
    expect(createArgs.data.expense.create.categoryId).toBe('cat-salary');
  });

  it('skips a deactivated staff member during automatic processing without erroring', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      {
        id: 'profile-1',
        staffMemberId: 'staff-1',
        baseSalary: decimal('100'),
        frequency: SalaryFrequency.MONTHLY,
        paymentMethod: SalaryPaymentMethod.CASH,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        nextPaymentDate: new Date('2026-09-01T00:00:00.000Z'),
        staffMember: { id: 'staff-1', name: 'X', storeId: 'store-1', status: StaffStatus.INACTIVE },
      },
    ]);

    const result = await service.runAutomaticPayments();

    expect(result.processed).toBe(0);
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });

  it('advances an inactive staff member\'s schedule instead of freezing it, so reactivation never back-pays', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      {
        id: 'profile-1',
        staffMemberId: 'staff-1',
        baseSalary: decimal('100'),
        frequency: SalaryFrequency.MONTHLY,
        paymentMethod: SalaryPaymentMethod.CASH,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        nextPaymentDate: new Date('2026-09-01T00:00:00.000Z'),
        staffMember: { id: 'staff-1', name: 'X', storeId: 'store-1', status: StaffStatus.INACTIVE },
      },
    ]);

    const result = await service.runAutomaticPayments();

    expect(result.skippedInactive).toBe(1);
    expect(prisma.staffSalaryProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: { nextPaymentDate: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('advances nextPaymentDate and creates a linked expense for a due AUTOMATIC profile', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      {
        id: 'profile-1',
        staffMemberId: 'staff-1',
        baseSalary: decimal('100'),
        frequency: SalaryFrequency.MONTHLY,
        paymentMethod: SalaryPaymentMethod.CASH,
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        nextPaymentDate: new Date('2026-09-01T00:00:00.000Z'),
        staffMember: { id: 'staff-1', name: 'Auto Staff', storeId: 'store-1', status: StaffStatus.ACTIVE },
      },
    ]);
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-salary' });
    prisma.staffSalaryPayment.create.mockResolvedValue({});

    const result = await service.runAutomaticPayments();

    expect(result.processed).toBe(1);
    expect(prisma.staffSalaryProfile.update).toHaveBeenCalledWith({
      where: { id: 'profile-1' },
      data: { nextPaymentDate: new Date('2026-10-01T00:00:00.000Z') },
    });
  });

  it('creates a fallback "Salaries" category when a store has none yet', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        name: 'Manual Staff',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.MANUAL, baseSalary: decimal('3000') },
      },
    ]);
    prisma.expenseCategory.findFirst.mockResolvedValue(null);
    prisma.expenseCategory.create.mockResolvedValue({ id: 'new-cat' });
    prisma.staffSalaryPayment.create.mockResolvedValue({
      id: 'payment-1',
      staffMemberId: 'staff-1',
      amount: decimal('3000'),
      paymentDate: new Date(),
      paidAt: new Date(),
      paymentMethod: SalaryPaymentMethod.CASH,
      status: 'PAID',
      notes: null,
      receiptUrl: null,
    });

    await service.createPayments('owner-user', {
      staffMemberIds: ['staff-1'],
      paymentDate: '2026-09-01',
      paymentMethod: SalaryPaymentMethod.CASH,
    });

    expect(prisma.expenseCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ group: 'SALARY' }) }),
    );
  });

  it('attaches a receiptAssetId to only the first payment in a bulk batch', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        name: 'A',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.MANUAL, baseSalary: decimal('1000') },
      },
      {
        id: 'staff-2',
        name: 'B',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.MANUAL, baseSalary: decimal('1000') },
      },
    ]);
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-salary' });
    prisma.staffSalaryPayment.create
      .mockResolvedValueOnce({ id: 'payment-1', staffMemberId: 'staff-1', amount: decimal('1000'), paymentDate: new Date(), paidAt: new Date(), paymentMethod: SalaryPaymentMethod.CASH, status: 'PAID', notes: null, receiptUrl: '/expenses/receipts/asset-1' })
      .mockResolvedValueOnce({ id: 'payment-2', staffMemberId: 'staff-2', amount: decimal('1000'), paymentDate: new Date(), paidAt: new Date(), paymentMethod: SalaryPaymentMethod.CASH, status: 'PAID', notes: null, receiptUrl: null });

    const result = await service.createPayments('owner-user', {
      staffMemberIds: ['staff-1', 'staff-2'],
      paymentDate: '2026-09-01',
      paymentMethod: SalaryPaymentMethod.CASH,
      receiptAssetId: 'asset-1',
    });

    expect(result.payments[0].receiptUrl).toBe('/expenses/receipts/asset-1');
    expect(result.payments[1].receiptUrl).toBeNull();
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'asset-1' }),
        data: expect.objectContaining({ salaryPaymentId: 'payment-1' }),
      }),
    );
  });

  it('rejects the whole batch when the receiptAssetId is stale/already used', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findMany.mockResolvedValue([
      {
        id: 'staff-1',
        name: 'A',
        salaryProfile: { expenseHandling: SalaryExpenseHandling.MANUAL, baseSalary: decimal('1000') },
      },
    ]);
    prisma.expenseCategory.findFirst.mockResolvedValue({ id: 'cat-salary' });
    prisma.staffSalaryPayment.create.mockResolvedValue({ id: 'payment-1' });
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.createPayments('owner-user', {
        staffMemberIds: ['staff-1'],
        paymentDate: '2026-09-01',
        paymentMethod: SalaryPaymentMethod.CASH,
        receiptAssetId: 'stale-asset',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('trend: sums payouts across all staff per month, scoped to this store', async () => {
    const { service, prisma } = build();
    const now = new Date('2026-09-15T00:00:00.000Z');
    prisma.staffSalaryPayment.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('1000'), paymentDate: new Date('2026-08-01T00:00:00.000Z') },
      { amount: new Prisma.Decimal('500'), paymentDate: new Date('2026-08-15T00:00:00.000Z') },
      { amount: new Prisma.Decimal('1500'), paymentDate: new Date('2026-09-01T00:00:00.000Z') },
    ]);
    jest.useFakeTimers().setSystemTime(now);

    const result = await service.trend('owner-user', { months: 2 });

    expect(prisma.staffSalaryPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ staffMember: { storeId: 'store-1' } }) }),
    );
    expect(result.points).toEqual([
      { month: '2026-08', total: '1500.00' },
      { month: '2026-09', total: '1500.00' },
    ]);
    expect(result.trend).toEqual({ changePercent: 0, direction: 'flat' });
    jest.useRealTimers();
  });
});

describe('advance', () => {
  it('clamps into a shorter month rather than overflowing (Jan 31 -> Feb 28, not Mar 3)', () => {
    const next = advance(new Date('2026-01-31T00:00:00.000Z'), SalaryFrequency.MONTHLY, 31);
    expect(next.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('returns to the anchor day once a long-enough month comes back around', () => {
    // Anchored on the 31st: Jan 31 -> Feb 28 (clamped) -> Mar 31 (back to
    // anchor, not stuck at 28 forever) -> Apr 30 (clamped again).
    const feb = advance(new Date('2026-01-31T00:00:00.000Z'), SalaryFrequency.MONTHLY, 31);
    const mar = advance(feb, SalaryFrequency.MONTHLY, 31);
    const apr = advance(mar, SalaryFrequency.MONTHLY, 31);

    expect(mar.toISOString()).toBe('2026-03-31T00:00:00.000Z');
    expect(apr.toISOString()).toBe('2026-04-30T00:00:00.000Z');
  });

  it('DAILY and WEEKLY advance by fixed offsets regardless of anchorDay', () => {
    const daily = advance(new Date('2026-09-01T00:00:00.000Z'), SalaryFrequency.DAILY, 1);
    const weekly = advance(new Date('2026-09-01T00:00:00.000Z'), SalaryFrequency.WEEKLY, 1);
    expect(daily.toISOString()).toBe('2026-09-02T00:00:00.000Z');
    expect(weekly.toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });
});
