import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
  StaffStatus,
} from '@prisma/client';
import { StaffSalaryService, advance } from './staff-salary.service';
import type { CreateSalaryPaymentDto } from './dto/staff-salary.dto';

const profile = {
  id: 'profile-1',
  staffMemberId: 'staff-1',
  baseSalary: new Prisma.Decimal('100'),
  startDate: new Date('2026-01-31'),
  nextPaymentDate: new Date('2026-09-30'),
  frequency: SalaryFrequency.MONTHLY,
  paymentMethod: SalaryPaymentMethod.CASH,
  expenseHandling: SalaryExpenseHandling.AUTOMATIC,
  notes: null,
};
const staff = {
  id: 'staff-1',
  name: 'Sara',
  photoUrl: null,
  jobTitle: 'Operations',
  storeId: 'store-1',
  status: StaffStatus.ACTIVE,
  salaryProfile: profile,
};
const payment = {
  id: 'payment-1',
  staffMemberId: staff.id,
  staffMember: staff,
  amount: new Prisma.Decimal('100'),
  paymentDate: new Date('2026-09-01'),
  scheduledFor: new Date('2026-09-01'),
  paidAt: null,
  status: SalaryPaymentStatus.PENDING,
  paymentMethod: SalaryPaymentMethod.CASH,
  frequency: SalaryFrequency.MONTHLY,
  expenseHandling: SalaryExpenseHandling.AUTOMATIC,
  expenseId: null,
  receiptUrl: null,
  notes: null,
};
const batch: CreateSalaryPaymentDto = {
  idempotencyKey: '14a3a49b-2d65-45cd-b467-8ae3e6f59142',
  staffMemberIds: [staff.id],
  paymentDate: '2026-09-01',
  paymentMethod: SalaryPaymentMethod.CASH,
};
function build() {
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: staff.id }]),
    staffMember: {
      findFirst: jest.fn().mockResolvedValue(staff),
      findUniqueOrThrow: jest.fn().mockResolvedValue(staff),
    },
    staffSalaryProfile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    staffSalaryPayment: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: any) =>
          where.id ? { staffMemberId: staff.id } : null,
        ),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...payment }),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      aggregate: jest.fn(),
    },
    expenseCategory: {
      findFirst: jest.fn().mockResolvedValue({ id: 'salary-category' }),
      upsert: jest.fn(),
    },
    expense: { create: jest.fn().mockResolvedValue({ id: 'expense-1' }) },
    mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  prisma.$transaction = jest.fn((cb) => cb(prisma));
  prisma.staffSalaryPayment.create.mockImplementation(({ data }: any) => ({
    ...payment,
    ...data,
    amount: new Prisma.Decimal(data.amount),
    staffMember: staff,
  }));
  prisma.staffSalaryPayment.update.mockImplementation(({ data }: any) => ({
    ...payment,
    ...data,
    staffMember: staff,
  }));
  prisma.staffSalaryProfile.upsert.mockImplementation(({ update }: any) => ({
    ...profile,
    ...update,
    baseSalary: new Prisma.Decimal(update.baseSalary),
  }));
  const access = {
    requireOwner: jest.fn().mockResolvedValue({
      storeId: 'store-1',
      baseCurrency: 'MAD',
      isOwner: true,
    }),
  };
  return {
    prisma,
    access,
    service: new StaffSalaryService(prisma, access as never),
  };
}

describe('StaffSalaryService lifecycle', () => {
  afterEach(() => jest.useRealTimers());
  it('gates salary management to owners before reading or writing', async () => {
    const { service, access, prisma } = build();
    access.requireOwner.mockRejectedValue(new ForbiddenException());
    await expect(
      service.createPayments('staff-user', batch),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('rejects cross-store profiles and payments', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue(null);
    prisma.staffSalaryPayment.findFirst.mockResolvedValue(null);
    await expect(
      service.getProfile('owner', 'other-staff'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.confirmPayment('owner', 'other-payment', {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
  it('preserves the schedule when switching expense mode or editing amount', async () => {
    const { service } = build();
    const result = await service.setProfile('owner', staff.id, {
      baseSalary: '200',
      startDate: '2026-01-31',
      frequency: SalaryFrequency.MONTHLY,
      paymentMethod: SalaryPaymentMethod.CASH,
      expenseHandling: SalaryExpenseHandling.MANUAL,
    });
    expect(result.nextPaymentDate).toBe('2026-09-30T00:00:00.000Z');
    expect(result.expenseHandling).toBe('MANUAL');
  });
  it('changing frequency alone preserves the next due date instead of recreating history', async () => {
    const { service } = build();
    const result = await service.setProfile('owner', staff.id, {
      baseSalary: '100',
      startDate: '2026-01-31',
      frequency: SalaryFrequency.WEEKLY,
      paymentMethod: SalaryPaymentMethod.CASH,
    });
    expect(result.nextPaymentDate).toBe('2026-09-30T00:00:00.000Z');
  });
  it('a frequency change starts a new schedule, without editing previous obligations', async () => {
    const { service, prisma } = build();
    const result = await service.setProfile('owner', staff.id, {
      baseSalary: '200',
      startDate: '2026-10-01',
      frequency: SalaryFrequency.WEEKLY,
      paymentMethod: SalaryPaymentMethod.CASH,
    });
    expect(result.nextPaymentDate).toBe('2026-10-01T00:00:00.000Z');
    expect(prisma.staffSalaryPayment.update).not.toHaveBeenCalled();
  });
  it('creates pending records without expenses even for automatic profiles', async () => {
    const { service, prisma } = build();
    const result = await service.createPayments('owner', batch);
    expect(result.payments[0]).toMatchObject({
      status: 'PENDING',
      paidAt: null,
      amount: '100.00',
      jobTitle: 'Operations',
      expenseRecorded: false,
      frequency: 'MONTHLY',
    });
    expect(prisma.expense.create).not.toHaveBeenCalled();
    expect(
      prisma.staffSalaryPayment.create.mock.calls[0][0].data,
    ).toMatchObject({
      scheduledFor: new Date('2026-09-01'),
      idempotencyKey: batch.idempotencyKey,
    });
  });
  it('rejects cross-store batches through the locked staff lookup', async () => {
    const { service, prisma } = build();
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(service.createPayments('owner', batch)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });
  it('does not recreate legacy payments that have no scheduled date key', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findFirst.mockResolvedValue({
      id: 'legacy-payment',
    });
    await expect(service.createPayments('owner', batch)).rejects.toThrow(
      'legacy-payment',
    );
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });
  it('requires amount if no profile exists', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findUniqueOrThrow.mockResolvedValue({
      ...staff,
      salaryProfile: null,
    });
    await expect(service.createPayments('owner', batch)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('returns the existing batch on retry and rejects a changed request with the same key', async () => {
    const { service, prisma } = build();
    await service.createPayments('owner', batch);
    const saved = prisma.staffSalaryPayment.create.mock.results[0].value;
    prisma.staffSalaryPayment.findMany.mockResolvedValue([saved]);
    await service.createPayments('owner', batch);
    expect(prisma.staffSalaryPayment.create).toHaveBeenCalledTimes(1);
    await expect(
      service.createPayments('owner', { ...batch, amount: '200' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects a new batch if the scheduled obligation exists', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findUnique.mockResolvedValue(payment);
    await expect(service.createPayments('owner', batch)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });
  it('an explicit paid batch creates its automatic expense using actual payout time', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const { service, prisma } = build();
    const result = await service.createPayments('owner', {
      ...batch,
      status: SalaryPaymentStatus.PAID,
    });
    expect(result.payments[0].expenseId).toBe('expense-1');
    expect(prisma.expense.create.mock.calls[0][0].data).toMatchObject({
      amount: new Prisma.Decimal('100'),
      spentAt: new Date('2026-09-29T12:00:00Z'),
      paymentMethod: 'CASH',
      storeId: 'store-1',
      staffMemberId: staff.id,
    });
  });
  it('confirmation creates one automatic expense and repeated confirmation is harmless', async () => {
    const { service, prisma } = build();
    const result = await service.confirmPayment('owner', payment.id, {
      paidAt: '2026-01-01',
      paymentMethod: SalaryPaymentMethod.BANK_TRANSFER,
    });
    expect(result).toMatchObject({
      status: 'PAID',
      expenseId: 'expense-1',
      paymentMethod: 'BANK_TRANSFER',
    });
    prisma.staffSalaryPayment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      status: SalaryPaymentStatus.PAID,
      expenseId: 'expense-1',
    });
    await service.confirmPayment('owner', payment.id, {});
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
  });
  it('manual handling records the linked expense and its record action is retry safe', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      expenseHandling: 'MANUAL',
    });
    await service.recordExpense('owner', payment.id);
    prisma.staffSalaryPayment.findUniqueOrThrow.mockResolvedValue({
      ...payment,
      status: 'PAID',
      paidAt: new Date('2026-01-01'),
      expenseHandling: 'MANUAL',
      expenseId: 'expense-1',
    });
    await service.recordExpense('owner', payment.id);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
  });
  it('recording a pending salary marks it paid and future confirmations fail', async () => {
    const { service, prisma } = build();
    const result = await service.recordExpense('owner', payment.id);
    expect(result).toMatchObject({ status: 'PAID', expenseId: 'expense-1' });
    await expect(
      service.confirmPayment('owner', payment.id, { paidAt: '2100-01-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
  });
  it('stale receipts reject the transaction', async () => {
    const { service, prisma } = build();
    prisma.mediaAsset.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      service.createPayments('owner', { ...batch, receiptAssetId: 'asset-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.expense.create).not.toHaveBeenCalled();
  });
  it.each([SalaryExpenseHandling.AUTOMATIC, SalaryExpenseHandling.MANUAL])(
    'scheduler handles %s obligations and catches up',
    async (mode) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-10-31T12:00:00Z'));
      const { service, prisma } = build();
      prisma.staffSalaryProfile.findMany.mockResolvedValue([
        { staffMemberId: staff.id, staffMember: staff },
      ]);
      prisma.staffSalaryProfile.findUnique.mockResolvedValue({
        ...profile,
        expenseHandling: mode,
        staffMember: staff,
      });
      expect(await service.runAutomaticPayments()).toEqual({
        processed: 2,
        skippedInactive: 0,
      });
      expect(
        prisma.staffSalaryPayment.create.mock.calls[0][0].data,
      ).toMatchObject({
        status: mode === SalaryExpenseHandling.AUTOMATIC ? 'PAID' : 'PENDING',
        expenseHandling: mode,
      });
      expect(
        prisma.staffSalaryProfile.update.mock.calls[0][0].data.nextPaymentDate.toISOString(),
      ).toBe('2026-11-30T00:00:00.000Z');
      expect(prisma.expense.create).toHaveBeenCalledTimes(
        mode === SalaryExpenseHandling.AUTOMATIC ? 2 : 0,
      );
    },
  );
  it('scheduler skips existing occurrences and another worker that already advanced the cursor', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T12:00:00Z'));
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      { staffMemberId: staff.id, staffMember: staff },
    ]);
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      ...profile,
      staffMember: staff,
    });
    prisma.staffSalaryPayment.findUnique.mockResolvedValue(payment);
    expect((await service.runAutomaticPayments()).processed).toBe(1);
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      ...profile,
      nextPaymentDate: new Date('2026-10-31'),
      staffMember: staff,
    });
    await service.runAutomaticPayments();
    expect(prisma.staffSalaryProfile.update).toHaveBeenCalledTimes(1);
    expect(prisma.staffSalaryPayment.create).not.toHaveBeenCalled();
  });
  it('accrues legacy due dates with a time component on the correct UTC day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-30T08:00:00Z'));
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      { staffMemberId: staff.id, staffMember: staff },
    ]);
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      ...profile,
      nextPaymentDate: new Date('2026-09-30T18:00:00Z'),
      staffMember: staff,
    });
    expect((await service.runAutomaticPayments()).processed).toBe(1);
    expect(
      prisma.staffSalaryPayment.create.mock.calls[0][0].data.paymentDate,
    ).toEqual(new Date('2026-09-30'));
  });
  it('inactive schedules continue normally', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-31'));
    const { service, prisma } = build();
    prisma.staffSalaryProfile.findMany.mockResolvedValue([
      { staffMemberId: staff.id, staffMember: staff },
    ]);
    prisma.staffSalaryProfile.findUnique.mockResolvedValue({
      ...profile,
      staffMember: { ...staff, status: 'INACTIVE' },
    });
    expect(await service.runAutomaticPayments()).toEqual({
      processed: 4,
      skippedInactive: 0,
    });
    expect(
      prisma.staffSalaryProfile.update.mock.calls[0][0].data.nextPaymentDate.toISOString(),
    ).toBe('2027-01-31T00:00:00.000Z');
  });
  it('annual summary combines paid, unpaid and forecast once per date', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findMany.mockResolvedValue([
      { ...payment, status: 'PAID', paidAt: new Date('2026-09-01') },
      {
        ...payment,
        paymentDate: new Date('2026-09-30'),
        scheduledFor: new Date('2026-09-30'),
      },
    ]);
    const result = await service.annualSummary('owner', staff.id, {
      year: 2026,
    });
    expect(result).toMatchObject({
      currency: 'MAD',
      totalPaidThisYear: '100.00',
      remainingPayments: 4,
      remainingAmount: '400.00',
      annualTotal: '500.00',
      projected: true,
    });
  });
  it('inactive staff annual summary includes future projections', async () => {
    const { service, prisma } = build();
    prisma.staffMember.findFirst.mockResolvedValue({
      ...staff,
      status: 'INACTIVE',
    });
    expect(
      (await service.annualSummary('owner', staff.id, { year: 2026 }))
        .projected,
    ).toBe(true);
  });
  it('trend reads only actual paid timestamps, keeping pending liabilities out', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29'));
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findMany.mockResolvedValue([
      { amount: new Prisma.Decimal('100'), paidAt: new Date('2026-09-01') },
    ]);
    expect((await service.trend('owner', { months: 2 })).points).toEqual([
      { month: '2026-08', total: '0.00' },
      { month: '2026-09', total: '100.00' },
    ]);
    expect(
      prisma.staffSalaryPayment.findMany.mock.calls[0][0].where.status,
    ).toBe('PAID');
  });
  it('the list filter keeps due-today obligations pending throughout the day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00Z'));
    const { service, prisma } = build();
    prisma.staffSalaryPayment.findMany.mockResolvedValue([
      { ...payment, paymentDate: new Date('2026-09-29') },
    ]);
    expect(
      (await service.listStorePayments('owner', { status: 'PENDING' }))
        .payments[0].displayStatus,
    ).toBe('PENDING');
    expect(
      prisma.staffSalaryPayment.findMany.mock.calls[0][0].where.paymentDate.gte,
    ).toEqual(new Date('2026-09-29'));
  });
  it('summary returns exact decimals and currency', async () => {
    const { service, prisma } = build();
    prisma.staffSalaryPayment.aggregate
      .mockResolvedValueOnce({ _sum: { amount: new Prisma.Decimal('100.01') } })
      .mockResolvedValueOnce({
        _sum: { amount: new Prisma.Decimal('20.02') },
        _count: 2,
      });
    expect(await service.summary('owner')).toEqual({
      currency: 'MAD',
      totalSalaryPaid: '100.01',
      pendingPaymentCount: 2,
      pendingPaymentsTotal: '20.02',
    });
  });
});

describe('advance', () => {
  it('clamps February then restores the original monthly anchor', () => {
    const feb = advance(new Date('2026-01-31'), SalaryFrequency.MONTHLY, 31);
    expect(feb.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(advance(feb, SalaryFrequency.MONTHLY, 31).toISOString()).toBe(
      '2026-03-31T00:00:00.000Z',
    );
  });
  it('handles leap years, daily and weekly UTC dates', () => {
    expect(
      advance(
        new Date('2028-01-31'),
        SalaryFrequency.MONTHLY,
        31,
      ).toISOString(),
    ).toBe('2028-02-29T00:00:00.000Z');
    expect(
      advance(new Date('2026-12-31'), SalaryFrequency.DAILY, 31).toISOString(),
    ).toBe('2027-01-01T00:00:00.000Z');
    expect(
      advance(new Date('2026-12-31'), SalaryFrequency.WEEKLY, 31).toISOString(),
    ).toBe('2027-01-07T00:00:00.000Z');
  });
});
