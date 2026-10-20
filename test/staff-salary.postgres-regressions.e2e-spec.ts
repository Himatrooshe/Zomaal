import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient, SalaryPaymentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { StaffController } from '../src/staff/staff.controller';
import { StaffSalaryController } from '../src/staff/staff-salary.controller';
import { StaffSalarySchedulerController } from '../src/staff/staff-salary-scheduler.controller';
import { StaffSalarySchedulerGuard } from '../src/staff/staff-salary-scheduler.guard';
import { StaffService } from '../src/staff/staff.service';
import { StaffSalaryService } from '../src/staff/staff-salary.service';
import { ProfileMediaService } from '../src/profile-media/profile-media.service';
import { StoreAccessService } from '../src/access/store-access.service';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';
import { calendarDay } from '../src/common/calendar-date.util';

const url = process.env.STAFF_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const secret = 'local-staff-regression-scheduler-secret-only';
type Payment = { id: string; displayStatus: string; amount: string };
type Points = { points: { month: string; total: string }[] };
postgres('Staff live findings with PostgreSQL and HTTP validation', () => {
  let db: PrismaClient, pool: Pool, app: INestApplication, server: Server;
  let ownerId: string, storeId: string, staffId: string, staffUserId: string;
  const ownerIds: string[] = [],
    staffUserIds: string[] = [];
  const profile = (extra: Record<string, unknown> = {}) => ({
    baseSalary: '100.25',
    frequency: 'MONTHLY',
    paymentMethod: 'CASH',
    expenseHandling: 'MANUAL',
    startDate: '2026-01-31',
    ...extra,
  });
  const batch = (extra: Record<string, unknown> = {}) => ({
    idempotencyKey: randomUUID(),
    staffMemberIds: [staffId],
    amount: '10.25',
    paymentDate: '2026-01-31',
    paymentMethod: 'CASH',
    ...extra,
  });
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      !/(?:test|_ci$)/.test(parsed.pathname)
    )
      throw new Error(
        'Dedicated local Staff regression test database required',
      );
    pool = new Pool({ connectionString: url, max: 10 });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    const access = new StoreAccessService(db as PrismaService);
    const module = await Test.createTestingModule({
      controllers: [
        StaffController,
        StaffSalaryController,
        StaffSalarySchedulerController,
      ],
      providers: [
        {
          provide: StaffService,
          useValue: new StaffService(db as PrismaService, access),
        },
        {
          provide: StaffSalaryService,
          useValue: new StaffSalaryService(db as PrismaService, access),
        },
        { provide: ProfileMediaService, useValue: {} },
        StaffSalarySchedulerGuard,
        {
          provide: ConfigService,
          useValue: new ConfigService({
            STAFF_SALARY_SCHEDULER_ENABLED: 'true',
            STAFF_SALARY_SCHEDULER_SECRET: secret,
          }),
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(ctx: ExecutionContext) {
          ctx.switchToHttp().getRequest<{ user: { userId: string } }>().user = {
            userId: ownerId,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.listen(0, '127.0.0.1');
    server = app.getHttpServer() as Server;
  });
  beforeEach(async () => {
    ownerId = (
      await db.user.create({
        data: { phone: `staff-reg-owner-${randomUUID()}` },
      })
    ).id;
    ownerIds.push(ownerId);
    storeId = (
      await db.store.create({
        data: {
          userId: ownerId,
          ownerName: 'QA',
          businessName: 'Staff regressions',
          address: 'Test',
          city: 'Test',
          country: 'Morocco',
        },
      })
    ).id;
    await db.user.update({
      where: { id: ownerId },
      data: { activeStoreId: storeId },
    });
    staffUserId = (
      await db.user.create({ data: { phone: `staff-reg-${randomUUID()}` } })
    ).id;
    staffUserIds.push(staffUserId);
    staffId = (
      await db.staffMember.create({
        data: {
          userId: staffUserId,
          storeId,
          name: 'Original QA',
          permissionOverrides: [],
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.staffSalaryProfile.deleteMany({
      where: { staffMember: { storeId } },
    });
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      await db.user.deleteMany({ where: { id: { in: ownerIds } } });
      await db.user.deleteMany({ where: { id: { in: staffUserIds } } });
      await db.$disconnect();
    }
    await pool?.end();
  });
  it.each(['name', 'phone', 'permissionOverrides', 'status', 'salary'])(
    'rejects null %s before touching the database',
    async (field) => {
      await request(server)
        .patch(`/staff/${staffId}`)
        .send({ [field]: null })
        .expect(400);
      expect(
        (await db.staffMember.findUniqueOrThrow({ where: { id: staffId } }))
          .name,
      ).toBe('Original QA');
    },
  );
  it('rejects whitespace names, trims valid names and permits deliberate role removal', async () => {
    await request(server)
      .patch(`/staff/${staffId}`)
      .send({ name: '   ' })
      .expect(400);
    await request(server)
      .patch(`/staff/${staffId}`)
      .send({ name: '  Valid QA  ', roleId: null })
      .expect(200);
    expect(
      (await db.staffMember.findUniqueOrThrow({ where: { id: staffId } })).name,
    ).toBe('Valid QA');
  });
  it.each(['/staff', '/staff/salary/payments'])(
    'bounds %s pagination',
    async (path) => {
      for (const page of [
        '999999999999999999999',
        '1000001',
        '1e3',
        '0x10',
        '1.5',
        '1junk',
      ])
        await request(server).get(path).query({ page }).expect(400);
      await request(server)
        .get(path)
        .query({ page: '1000000', limit: '1' })
        .expect(200);
    },
  );
  it.each([
    '2026-02-30',
    '2026-02',
    '2025-02-29',
    '2026-04-31',
    '2026-10-01T12:00:00',
  ])('rejects invalid calendar input %s atomically', async (date) => {
    await request(server)
      .post('/staff/salary/payments')
      .send(batch({ paymentDate: date }))
      .expect(400);
    await request(server)
      .put(`/staff/${staffId}/salary`)
      .send(profile({ startDate: date }))
      .expect(400);
    expect(
      await db.staffSalaryPayment.count({ where: { staffMemberId: staffId } }),
    ).toBe(0);
    expect(
      await db.staffSalaryProfile.count({ where: { staffMemberId: staffId } }),
    ).toBe(0);
  });
  it('retains a date-only label and converts timestamp input with the phone timezone', async () => {
    const first = await request(server)
      .post('/staff/salary/payments')
      .send(batch({ paymentDate: '2026-10-01', timezone: 'America/New_York' }))
      .expect(201);
    expect(
      (first.body as { payments: { paymentDate: string }[] }).payments[0]
        .paymentDate,
    ).toBe('2026-10-01T00:00:00.000Z');
    await request(server)
      .post('/staff/salary/payments')
      .send(
        batch({
          paymentDate: '2026-10-01T00:30:00Z',
          timezone: 'America/New_York',
        }),
      )
      .expect(201);
    const dates = await db.staffSalaryPayment.findMany({
      where: { staffMemberId: staffId },
      orderBy: { paymentDate: 'asc' },
    });
    expect(dates.map((p) => p.paymentDate.toISOString())).toEqual([
      '2026-09-30T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
    ]);
  });
  it.each(['Invalid/Zone', null])(
    'rejects invalid timezone %s on read and write',
    async (timezone) => {
      await request(server)
        .put(`/staff/${staffId}/salary`)
        .send(profile({ timezone }))
        .expect(400);
      await request(server)
        .post('/staff/salary/payments')
        .send(batch({ timezone }))
        .expect(400);
      if (timezone)
        for (const path of [
          '/staff/salary/payments',
          '/staff/salary/trend',
          `/staff/${staffId}/salary/annual-summary`,
        ])
          await request(server).get(path).query({ timezone }).expect(400);
    },
  );
  it('paid month grouping follows the requested timezone across a month boundary', async () => {
    const now = new Date(),
      utcMonth = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
      );
    await db.staffSalaryPayment.create({
      data: {
        staffMemberId: staffId,
        amount: '12.34',
        paymentDate: utcMonth,
        paidAt: new Date(utcMonth.getTime() + 30 * 60000),
        status: 'PAID',
        paymentMethod: 'CASH',
      },
    });
    const utc = await request(server)
      .get('/staff/salary/trend')
      .query({ months: 3, timezone: 'UTC' })
      .expect(200);
    const ny = await request(server)
      .get('/staff/salary/trend')
      .query({ months: 3, timezone: 'America/New_York' })
      .expect(200);
    const utcKey = utcMonth.toISOString().slice(0, 7);
    const nyKey = calendarDay(
      new Date(utcMonth.getTime() + 30 * 60000),
      'America/New_York',
    )
      .toISOString()
      .slice(0, 7);
    expect(
      (utc.body as Points).points.find((p) => p.month === utcKey)?.total,
    ).toBe('12.34');
    expect(
      (ny.body as Points).points.find((p) => p.month === utcKey)?.total,
    ).toBe('0.00');
    expect(
      (ny.body as Points).points.find((p) => p.month === nyKey)?.total,
    ).toBe('12.34');
  });
  it('annual payout totals use local year boundaries without moving due-date labels', async () => {
    await db.staffSalaryPayment.create({
      data: {
        staffMemberId: staffId,
        amount: '20.00',
        paymentDate: new Date('2025-12-31'),
        paidAt: new Date('2026-01-01T00:30:00Z'),
        status: 'PAID',
        paymentMethod: 'CASH',
      },
    });
    const utc = await request(server)
      .get(`/staff/${staffId}/salary/annual-summary`)
      .query({ year: 2026, timezone: 'UTC' })
      .expect(200);
    const ny = await request(server)
      .get(`/staff/${staffId}/salary/annual-summary`)
      .query({ year: 2026, timezone: 'America/New_York' })
      .expect(200);
    expect((utc.body as { totalPaidThisYear: string }).totalPaidThisYear).toBe(
      '20.00',
    );
    expect((ny.body as { totalPaidThisYear: string }).totalPaidThisYear).toBe(
      '0.00',
    );
  });
  it('status filters and response chips use the same phone-local today', async () => {
    const now = new Date();
    const easternDay = calendarDay(now, 'Pacific/Kiritimati'),
      westernDay = calendarDay(now, 'Etc/GMT+12');
    expect(easternDay.getTime()).toBeGreaterThan(westernDay.getTime());
    await db.staffSalaryPayment.create({
      data: {
        staffMemberId: staffId,
        amount: '1',
        paymentDate: westernDay,
        status: 'PENDING',
        paymentMethod: 'CASH',
      },
    });
    const east = await request(server)
      .get('/staff/salary/payments')
      .query({ status: 'OVERDUE', timezone: 'Pacific/Kiritimati' })
      .expect(200);
    const west = await request(server)
      .get('/staff/salary/payments')
      .query({ status: 'PENDING', timezone: 'Etc/GMT+12' })
      .expect(200);
    expect((east.body as { payments: Payment[] }).payments).toHaveLength(1);
    expect(
      (east.body as { payments: Payment[] }).payments[0].displayStatus,
    ).toBe('OVERDUE');
    expect(
      (west.body as { payments: Payment[] }).payments[0].displayStatus,
    ).toBe('PENDING');
  });
  it('saves a schedule timezone and preserves it and its cursor on omitted-timezone edits', async () => {
    await request(server)
      .put(`/staff/${staffId}/salary`)
      .send(profile({ timezone: 'Asia/Dhaka' }))
      .expect(200);
    const previous = await db.staffSalaryProfile.findUniqueOrThrow({
      where: { staffMemberId: staffId },
    });
    await request(server)
      .put(`/staff/${staffId}/salary`)
      .send(profile({ baseSalary: '200.00' }))
      .expect(200);
    const current = await db.staffSalaryProfile.findUniqueOrThrow({
      where: { staffMemberId: staffId },
    });
    expect(current.timezone).toBe('Asia/Dhaka');
    expect(current.nextPaymentDate).toEqual(previous.nextPaymentDate);
  });
  it('scheduler is protected, uses saved local dates, and concurrent retries create one expense', async () => {
    const now = new Date(),
      localDay = calendarDay(now, 'Pacific/Kiritimati');
    await db.staffSalaryProfile.create({
      data: {
        staffMemberId: staffId,
        baseSalary: '25.50',
        startDate: localDay,
        nextPaymentDate: localDay,
        frequency: 'MONTHLY',
        paymentMethod: 'CASH',
        expenseHandling: 'AUTOMATIC',
        timezone: 'Pacific/Kiritimati',
      },
    });
    await request(server).post('/internal/staff-salary/run').expect(401);
    await request(server)
      .post('/internal/staff-salary/run')
      .set('x-zomaal-scheduler-secret', 'wrong')
      .expect(401);
    await Promise.all([
      request(server)
        .post('/internal/staff-salary/run')
        .set('x-zomaal-scheduler-secret', secret)
        .expect(200),
      request(server)
        .post('/internal/staff-salary/run')
        .set('x-zomaal-scheduler-secret', secret)
        .expect(200),
    ]);
    const payments = await db.staffSalaryPayment.findMany({
      where: { staffMemberId: staffId },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].status).toBe(SalaryPaymentStatus.PAID);
    expect(payments[0].paymentDate).toEqual(localDay);
    expect(await db.expense.count({ where: { staffMemberId: staffId } })).toBe(
      1,
    );
  });
  it('scheduler does not accrue a future local date', async () => {
    const tomorrow = calendarDay(new Date(), 'Etc/GMT+12');
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    await db.staffSalaryProfile.create({
      data: {
        staffMemberId: staffId,
        baseSalary: '25.50',
        startDate: tomorrow,
        nextPaymentDate: tomorrow,
        frequency: 'DAILY',
        paymentMethod: 'CASH',
        timezone: 'Etc/GMT+12',
      },
    });
    await request(server)
      .post('/internal/staff-salary/run')
      .set('x-zomaal-scheduler-secret', secret)
      .expect(200);
    expect(
      await db.staffSalaryPayment.count({ where: { staffMemberId: staffId } }),
    ).toBe(0);
  });
  it('inactive staff retain the salary agreement, forecast and scheduled obligations', async () => {
    const day = calendarDay(new Date());
    await db.staffMember.update({
      where: { id: staffId },
      data: { status: 'INACTIVE' },
    });
    await db.staffSalaryProfile.create({
      data: {
        staffMemberId: staffId,
        baseSalary: '25.50',
        startDate: day,
        nextPaymentDate: day,
        frequency: 'MONTHLY',
        paymentMethod: 'CASH',
        expenseHandling: 'MANUAL',
      },
    });
    const annual = await request(server)
      .get(`/staff/${staffId}/salary/annual-summary`)
      .query({ year: day.getUTCFullYear() })
      .expect(200);
    expect((annual.body as { projected: boolean }).projected).toBe(true);
    await request(server)
      .post('/internal/staff-salary/run')
      .set('x-zomaal-scheduler-secret', secret)
      .expect(200);
    const paid = await db.staffSalaryPayment.findMany({
      where: { staffMemberId: staffId },
    });
    expect(paid).toHaveLength(1);
    expect(paid[0].status).toBe('PENDING');
    expect(await db.expense.count({ where: { staffMemberId: staffId } })).toBe(
      0,
    );
  });
});
