import { randomUUID } from 'node:crypto';
import {
  PrismaClient,
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
  StaffStatus,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { StaffSalaryService } from '../src/staff/staff-salary.service';
import { StaffService } from '../src/staff/staff.service';
import { StoreAccessService } from '../src/access/store-access.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { salaryDay } from '../src/staff/salary-payment-status.util';

// Explicit opt-in: never fall back to the application's DATABASE_URL.
const url = process.env.STAFF_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
postgres('Staff salary PostgreSQL transactions', () => {
  let db: PrismaClient;
  let pool: Pool;
  let salary: StaffSalaryService;
  let staffService: StaffService;
  let ownerId: string;
  let storeId: string;
  const staffUserIds: string[] = [];
  const today = salaryDay(new Date());

  beforeAll(async () => {
    const parsed = new URL(url!);
    if (!/(?:test|_ci$)/.test(parsed.pathname))
      throw new Error(
        'STAFF_TEST_DATABASE_URL must identify a dedicated test database',
      );
    pool = new Pool({ connectionString: url, max: 10 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const owner = await db.user.create({
      data: { phone: `test-owner-${randomUUID()}` },
    });
    ownerId = owner.id;
    const store = await db.store.create({
      data: {
        userId: ownerId,
        ownerName: 'Test owner',
        businessName: 'Salary transaction test',
        address: 'Test',
        city: 'Test',
        country: 'MA',
      },
    });
    storeId = store.id;
    await db.user.update({
      where: { id: ownerId },
      data: { activeStoreId: storeId },
    });
    const access = new StoreAccessService(db as PrismaService);
    salary = new StaffSalaryService(db as PrismaService, access);
    staffService = new StaffService(db as PrismaService, access);
  });

  afterAll(async () => {
    if (db) {
      if (ownerId) await db.user.delete({ where: { id: ownerId } });
      await db.user.deleteMany({ where: { id: { in: staffUserIds } } });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });

  async function person(
    mode: SalaryExpenseHandling = SalaryExpenseHandling.AUTOMATIC,
  ) {
    const user = await db.user.create({
      data: { phone: `test-staff-${randomUUID()}` },
    });
    staffUserIds.push(user.id);
    return db.staffMember.create({
      data: {
        userId: user.id,
        storeId,
        name: 'Test staff',
        permissionOverrides: [],
        salaryProfile: {
          create: {
            baseSalary: '100.25',
            frequency: SalaryFrequency.MONTHLY,
            paymentMethod: SalaryPaymentMethod.CASH,
            expenseHandling: mode,
            startDate: today,
            nextPaymentDate: today,
          },
        },
      },
    });
  }

  it('concurrent scheduler runs create one paid automatic obligation and expense', async () => {
    const staff = await person();
    await Promise.all([
      salary.runAutomaticPayments(),
      salary.runAutomaticPayments(),
    ]);
    const rows = await db.staffSalaryPayment.findMany({
      where: { staffMemberId: staff.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'PAID',
      paidAt: expect.any(Date),
      expenseId: expect.any(String),
    });
    expect(await db.expense.count({ where: { staffMemberId: staff.id } })).toBe(
      1,
    );
    const profile = await db.staffSalaryProfile.findUniqueOrThrow({
      where: { staffMemberId: staff.id },
    });
    expect(profile.nextPaymentDate!.getTime()).toBeGreaterThan(today.getTime());
  });

  it('concurrent manual expense records produce one expense with actor and amount retained', async () => {
    const staff = await person(SalaryExpenseHandling.MANUAL);
    await salary.runAutomaticPayments();
    const row = await db.staffSalaryPayment.findFirstOrThrow({
      where: { staffMemberId: staff.id },
    });
    const results = await Promise.all([
      salary.recordExpense(ownerId, row.id),
      salary.recordExpense(ownerId, row.id),
    ]);
    expect(results[0].expenseId).toBe(results[1].expenseId);
    const expenses = await db.expense.findMany({
      where: { staffMemberId: staff.id },
    });
    expect(expenses).toHaveLength(1);
    expect(expenses[0].amount.toFixed(2)).toBe('100.25');
    const paid = await db.staffSalaryPayment.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(paid.paidByUserId).toBe(ownerId);
    expect(expenses[0].spentAt).toEqual(paid.paidAt);
  });

  it('concurrent retries of a paid batch are idempotent, including expense side effects', async () => {
    const staff = await person();
    const dto = {
      idempotencyKey: randomUUID(),
      staffMemberIds: [staff.id],
      paymentDate: today.toISOString(),
      paymentMethod: SalaryPaymentMethod.CASH,
      status: SalaryPaymentStatus.PAID,
    };
    const [a, b] = await Promise.all([
      salary.createPayments(ownerId, dto),
      salary.createPayments(ownerId, dto),
    ]);
    expect(a.payments[0].id).toBe(b.payments[0].id);
    expect(
      await db.staffSalaryPayment.count({ where: { staffMemberId: staff.id } }),
    ).toBe(1);
    expect(await db.expense.count({ where: { staffMemberId: staff.id } })).toBe(
      1,
    );
    await expect(
      salary.createPayments(ownerId, { ...dto, amount: '200' }),
    ).rejects.toThrow('Idempotency key');
    await salary.runAutomaticPayments();
    expect(
      await db.staffSalaryPayment.count({ where: { staffMemberId: staff.id } }),
    ).toBe(1);
  });

  it('manual handling records the expense only after the owner requests it, exactly once', async () => {
    const staff = await person(SalaryExpenseHandling.MANUAL);
    await salary.runAutomaticPayments();
    const row = await db.staffSalaryPayment.findFirstOrThrow({
      where: { staffMemberId: staff.id },
    });
    const results = await Promise.all([
      salary.recordExpense(ownerId, row.id),
      salary.recordExpense(ownerId, row.id),
    ]);
    expect(results[0].expenseId).toBe(results[1].expenseId);
    expect(await db.expense.count({ where: { staffMemberId: staff.id } })).toBe(
      1,
    );
  });

  it('an invalid receipt rolls back all payments and expenses in the batch', async () => {
    const a = await person(),
      b = await person();
    await expect(
      salary.createPayments(ownerId, {
        idempotencyKey: randomUUID(),
        staffMemberIds: [a.id, b.id],
        paymentDate: today.toISOString(),
        paymentMethod: SalaryPaymentMethod.CASH,
        status: SalaryPaymentStatus.PAID,
        receiptAssetId: randomUUID(),
      }),
    ).rejects.toThrow('Receipt not found');
    expect(
      await db.staffSalaryPayment.count({
        where: { staffMemberId: { in: [a.id, b.id] } },
      }),
    ).toBe(0);
    expect(
      await db.expense.count({
        where: { staffMemberId: { in: [a.id, b.id] } },
      }),
    ).toBe(0);
  });

  it('failure to create a manual expense rolls the payment back to pending', async () => {
    const staff = await person(SalaryExpenseHandling.MANUAL);
    await salary.runAutomaticPayments();
    const row = await db.staffSalaryPayment.findFirstOrThrow({
      where: { staffMemberId: staff.id },
    });
    // Temporary trigger applies only to this disposable test fixture.
    await db.$executeRawUnsafe(
      `CREATE FUNCTION staff_test_expense_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."staffMemberId" = '${staff.id}' THEN RAISE EXCEPTION 'test expense failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      'CREATE TRIGGER staff_test_expense_failure BEFORE INSERT ON "Expense" FOR EACH ROW EXECUTE FUNCTION staff_test_expense_failure()',
    );
    try {
      await expect(salary.recordExpense(ownerId, row.id)).rejects.toThrow();
      const unchanged = await db.staffSalaryPayment.findUniqueOrThrow({
        where: { id: row.id },
      });
      expect(unchanged).toMatchObject({
        status: 'PENDING',
        paidAt: null,
        expenseId: null,
        paidByUserId: null,
      });
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER staff_test_expense_failure ON "Expense"',
      );
      await db.$executeRawUnsafe('DROP FUNCTION staff_test_expense_failure()');
    }
  });

  it('reactivation keeps the salary schedule running', async () => {
    const staff = await person();
    await staffService.setStatus(ownerId, staff.id, StaffStatus.INACTIVE);
    await staffService.setStatus(ownerId, staff.id, StaffStatus.ACTIVE);
    await salary.runAutomaticPayments();
    expect(
      await db.staffSalaryPayment.count({ where: { staffMemberId: staff.id } }),
    ).toBe(1);
  });

  it('staff creation saves account status and salary atomically, with no password in responses', async () => {
    const result = await staffService.create(ownerId, {
      name: 'Test inactive employee',
      phone: `test-create-${randomUUID()}`,
      password: 'test-only-password',
      status: StaffStatus.INACTIVE,
      salary: {
        baseSalary: '750.50',
        frequency: SalaryFrequency.MONTHLY,
        paymentMethod: SalaryPaymentMethod.CASH,
        startDate: today.toISOString(),
      },
    });
    const row = await db.staffMember.findUniqueOrThrow({
      where: { id: result.id },
    });
    staffUserIds.push(row.userId);
    expect(result.status).toBe('INACTIVE');
    expect(result.salaryProfile?.baseSalary).toBe('750.50');
    expect(result).not.toHaveProperty('passwordHash');
  });
});
