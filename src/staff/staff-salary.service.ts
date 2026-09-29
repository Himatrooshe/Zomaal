import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ExpensePaymentMethod,
  Prisma,
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
  StaffStatus,
  type StaffSalaryProfile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import {
  attachReceipt,
  receiptPreviewPath,
} from '../common/media/attach-receipt.util';
import {
  calculateTrend,
  lastNMonthKeys,
  monthKey,
  monthsAgoStart,
} from '../common/trend.util';
import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../common/dto/monthly-trend.dto';
import {
  ConfirmSalaryPaymentDto,
  CreateSalaryPaymentDto,
  SalaryAnnualQueryDto,
  SalaryAnnualSummaryDto,
  SalaryPaymentBatchResponseDto,
  SalaryPaymentListQueryDto,
  SalaryPaymentListResponseDto,
  SalaryPaymentResponseDto,
  SalaryProfileResponseDto,
  SalarySummaryResponseDto,
  SetSalaryProfileDto,
} from './dto/staff-salary.dto';
import {
  deriveSalaryDisplayStatus,
  salaryDay,
  type SalaryPaymentDisplayStatus,
} from './salary-payment-status.util';

const PAYMENT_INCLUDE = {
  staffMember: { include: { salaryProfile: true } },
} satisfies Prisma.StaffSalaryPaymentInclude;
type Payment = Prisma.StaffSalaryPaymentGetPayload<{
  include: typeof PAYMENT_INCLUDE;
}>;
const METHODS: Record<SalaryPaymentMethod, ExpensePaymentMethod> = {
  BANK_TRANSFER: ExpensePaymentMethod.BANK,
  CASH: ExpensePaymentMethod.CASH,
};

/** Lock order: batch advisory lock (when applicable), staff, profile/payment.
 * All writers use the staff lock so schedule edits, batches and confirmations serialize.
 */
@Injectable()
export class StaffSalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async getProfile(
    userId: string,
    staffId: string,
  ): Promise<{ profile: SalaryProfileResponseDto | null }> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    await this.requireStaff(storeId, staffId);
    const profile = await this.prisma.staffSalaryProfile.findUnique({
      where: { staffMemberId: staffId },
    });
    return { profile: profile ? toProfileResponse(profile) : null };
  }

  async setProfile(
    userId: string,
    staffId: string,
    dto: SetSalaryProfileDto,
  ): Promise<SalaryProfileResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    return this.prisma.$transaction(async (tx) => {
      await lockStaff(tx, storeId, staffId);
      const existing = await tx.staffSalaryProfile.findUnique({
        where: { staffMemberId: staffId },
      });
      const data = salaryProfileData(dto, existing);
      const profile = await tx.staffSalaryProfile.upsert({
        where: { staffMemberId: staffId },
        create: { staffMemberId: staffId, ...data },
        update: data,
      });
      return toProfileResponse(profile);
    });
  }

  async listPayments(
    userId: string,
    staffId: string,
    query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    await this.requireStaff(storeId, staffId);
    return this.listPaymentsForWhere(
      { staffMemberId: staffId, staffMember: { storeId } },
      query,
    );
  }

  async listStorePayments(
    userId: string,
    query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    return this.listPaymentsForWhere({ staffMember: { storeId } }, query);
  }

  private async listPaymentsForWhere(
    baseWhere: Prisma.StaffSalaryPaymentWhereInput,
    query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    const page = query.page ?? 1,
      limit = query.limit ?? 20,
      now = new Date();
    const where = { ...baseWhere, ...displayStatusWhere(query.status, now) };
    const [payments, total] = await Promise.all([
      this.prisma.staffSalaryPayment.findMany({
        where,
        orderBy: [{ paymentDate: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: PAYMENT_INCLUDE,
      }),
      this.prisma.staffSalaryPayment.count({ where }),
    ]);
    return {
      payments: payments.map((p) => toPaymentResponse(p, now)),
      total,
      page,
      limit,
    };
  }

  async summary(userId: string): Promise<SalarySummaryResponseDto> {
    const { storeId, baseCurrency } =
      await this.storeAccess.requireOwner(userId);
    const [paid, pending] = await Promise.all([
      this.prisma.staffSalaryPayment.aggregate({
        where: { staffMember: { storeId }, status: SalaryPaymentStatus.PAID },
        _sum: { amount: true },
      }),
      this.prisma.staffSalaryPayment.aggregate({
        where: {
          staffMember: { storeId },
          status: SalaryPaymentStatus.PENDING,
        },
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return {
      currency: baseCurrency,
      totalSalaryPaid: (paid._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      pendingPaymentCount: pending._count as number,
      pendingPaymentsTotal: (
        pending._sum.amount ?? new Prisma.Decimal(0)
      ).toFixed(2),
    };
  }

  async trend(
    userId: string,
    query: MonthlyTrendQueryDto,
  ): Promise<MonthlyTrendResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const months = query.months ?? 6,
      keys = lastNMonthKeys(months);
    const payments = await this.prisma.staffSalaryPayment.findMany({
      where: {
        staffMember: { storeId },
        status: SalaryPaymentStatus.PAID,
        paidAt: { gte: monthsAgoStart(months), lte: new Date() },
      },
      select: { amount: true, paidAt: true },
    });
    const totals = new Map<string, Prisma.Decimal>();
    for (const p of payments) {
      if (!p.paidAt) continue;
      const key = monthKey(p.paidAt);
      totals.set(
        key,
        (totals.get(key) ?? new Prisma.Decimal(0)).plus(p.amount),
      );
    }
    const points = keys.map((month) => ({
      month,
      total: (totals.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
    }));
    return {
      points,
      trend: calculateTrend(
        Number(points.at(-1)?.total ?? 0),
        Number(points.at(-2)?.total ?? 0),
      ),
    };
  }

  async createPayments(
    userId: string,
    dto: CreateSalaryPaymentDto,
  ): Promise<SalaryPaymentBatchResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const ids = [...dto.staffMemberIds].sort();
    const date = salaryDay(new Date(dto.paymentDate));
    const status = dto.status ?? SalaryPaymentStatus.PENDING;
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          ids,
          date: date.toISOString(),
          status,
          amount: dto.amount ? new Prisma.Decimal(dto.amount).toString() : null,
          method: dto.paymentMethod,
          handling: dto.expenseHandling ?? null,
          frequency: dto.frequency ?? null,
          notes: dto.notes ?? null,
          receipt: dto.receiptAssetId ?? dto.receiptUrl ?? null,
          receiptOwner: dto.receiptAssetId ? dto.staffMemberIds[0] : null,
        }),
      )
      .digest('hex');
    const payments = await this.prisma.$transaction(
      async (tx) => {
        // Scope the key to the store, including disjoint batches retried with the same key.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${storeId + ':' + dto.idempotencyKey}, 0))::text`;
        const retry = await tx.staffSalaryPayment.findMany({
          where: {
            idempotencyKey: dto.idempotencyKey,
            staffMember: { storeId },
          },
          include: PAYMENT_INCLUDE,
        });
        if (retry.length) {
          if (
            retry.length !== ids.length ||
            retry.some((p) => p.requestHash !== fingerprint)
          )
            throw new ConflictException(
              'Idempotency key was already used for a different salary batch',
            );
          return retry;
        }
        const created: Payment[] = [];
        for (const id of ids) {
          await lockStaff(tx, storeId, id);
          const staff = await tx.staffMember.findUniqueOrThrow({
            where: { id },
            include: { salaryProfile: true },
          });
          const prior = await findSalaryForDay(tx, id, date);
          if (prior)
            throw new ConflictException(
              `Salary record ${prior.id} already exists for this staff member and date; confirm that record instead`,
            );
          const amount =
            dto.amount ?? staff.salaryProfile?.baseSalary.toString();
          if (!amount)
            throw new BadRequestException(
              `Amount is required for ${staff.name}: no salary profile is set`,
            );
          const payment = await tx.staffSalaryPayment.create({
            data: {
              staffMemberId: id,
              amount,
              createdByUserId: userId,
              paidByUserId: status === SalaryPaymentStatus.PAID ? userId : null,
              paymentDate: date,
              scheduledFor: date,
              idempotencyKey: dto.idempotencyKey,
              requestHash: fingerprint,
              status,
              paidAt: status === SalaryPaymentStatus.PAID ? new Date() : null,
              paymentMethod: dto.paymentMethod,
              expenseHandling:
                dto.expenseHandling ??
                staff.salaryProfile?.expenseHandling ??
                SalaryExpenseHandling.AUTOMATIC,
              frequency:
                dto.frequency ?? staff.salaryProfile?.frequency ?? null,
              notes: dto.notes ?? null,
              receiptUrl:
                dto.receiptAssetId && id === dto.staffMemberIds[0]
                  ? receiptPreviewPath(dto.receiptAssetId)
                  : (dto.receiptUrl ?? null),
            },
            include: PAYMENT_INCLUDE,
          });
          if (dto.receiptAssetId && id === dto.staffMemberIds[0])
            await attachReceipt(tx, storeId, dto.receiptAssetId, {
              salaryPaymentId: payment.id,
            });
          if (status === SalaryPaymentStatus.PAID)
            await this.linkExpense(tx, storeId, userId, payment);
          created.push(payment);
        }
        return created;
      },
      { timeout: 30000 },
    );
    const byId = new Map(payments.map((p) => [p.staffMemberId, p]));
    return {
      payments: dto.staffMemberIds.map((id) =>
        toPaymentResponse(byId.get(id)!),
      ),
    };
  }

  async confirmPayment(
    userId: string,
    paymentId: string,
    dto: ConfirmSalaryPaymentDto,
  ): Promise<SalaryPaymentResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (paidAt > new Date())
      throw new BadRequestException(
        'Payment timestamp cannot be in the future',
      );
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, storeId, paymentId);
      if (payment.status === SalaryPaymentStatus.PAID)
        return toPaymentResponse(payment);
      if (payment.expenseHandling === SalaryExpenseHandling.MANUAL)
        throw new ConflictException(
          'Manual salaries are marked paid when the owner records their expense.',
        );
      if (dto.receiptAssetId) {
        if (payment.receiptUrl)
          throw new ConflictException(
            'This salary record already has a receipt',
          );
        await attachReceipt(tx, storeId, dto.receiptAssetId, {
          salaryPaymentId: paymentId,
        });
      }
      const updated = await tx.staffSalaryPayment.update({
        where: { id: paymentId },
        data: {
          status: SalaryPaymentStatus.PAID,
          paidAt,
          paidByUserId: userId,
          paymentMethod: dto.paymentMethod ?? payment.paymentMethod,
          receiptUrl: dto.receiptAssetId
            ? receiptPreviewPath(dto.receiptAssetId)
            : payment.receiptUrl,
        },
        include: PAYMENT_INCLUDE,
      });
      await this.linkExpense(tx, storeId, userId, updated);
      return toPaymentResponse(updated);
    });
  }

  async recordExpense(
    userId: string,
    paymentId: string,
  ): Promise<SalaryPaymentResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    return this.prisma.$transaction(async (tx) => {
      const payment = await this.lockPayment(tx, storeId, paymentId);
      const paid =
        payment.status === SalaryPaymentStatus.PAID && payment.paidAt
          ? payment
          : await tx.staffSalaryPayment.update({
              where: { id: paymentId },
              data: {
                status: SalaryPaymentStatus.PAID,
                paidAt: payment.paidAt ?? new Date(),
                paidByUserId: payment.paidByUserId ?? userId,
              },
              include: PAYMENT_INCLUDE,
            });
      await this.linkExpense(tx, storeId, userId, paid);
      return toPaymentResponse(paid);
    });
  }

  private async lockPayment(
    tx: Prisma.TransactionClient,
    storeId: string,
    paymentId: string,
  ): Promise<Payment> {
    const scoped = await tx.staffSalaryPayment.findFirst({
      where: { id: paymentId, staffMember: { storeId } },
      select: { staffMemberId: true },
    });
    if (!scoped) throw new NotFoundException('Salary payment not found');
    await lockStaff(tx, storeId, scoped.staffMemberId);
    return tx.staffSalaryPayment.findUniqueOrThrow({
      where: { id: paymentId },
      include: PAYMENT_INCLUDE,
    });
  }

  private async linkExpense(
    tx: Prisma.TransactionClient,
    storeId: string,
    userId: string | null,
    payment: Payment,
  ): Promise<void> {
    if (payment.expenseId) return;
    const category =
      (await tx.expenseCategory.findFirst({
        where: { storeId, group: 'SALARY' },
        select: { id: true },
      })) ??
      (await tx.expenseCategory.upsert({
        where: { storeId_name: { storeId, name: 'Employee salary' } },
        create: {
          storeId,
          name: 'Employee salary',
          group: 'SALARY',
          isSystem: true,
        },
        update: {},
        select: { id: true, group: true },
      }));
    if ('group' in category && category.group !== 'SALARY')
      throw new ConflictException(
        'The Employee salary category must belong to the SALARY group',
      );
    const expense = await tx.expense.create({
      data: {
        storeId,
        title: `Salary — ${payment.staffMember.name}`,
        amount: payment.amount,
        paymentMethod: METHODS[payment.paymentMethod],
        spentAt: payment.paidAt!,
        categoryId: category.id,
        staffMemberId: payment.staffMemberId,
        createdByUserId: userId,
        notes: payment.notes,
        receiptUrl: payment.receiptUrl,
      },
    });
    await tx.staffSalaryPayment.update({
      where: { id: payment.id },
      data: { expenseId: expense.id },
    });
    payment.expenseId = expense.id;
  }

  /** Accrue obligations, never claim a bank/cash transfer occurred. Safe across replicas. */
  async runAutomaticPayments(): Promise<{
    processed: number;
    skippedInactive: number;
  }> {
    const today = salaryDay(new Date());
    const due = await this.prisma.staffSalaryProfile.findMany({
      where: { nextPaymentDate: { lt: new Date(today.getTime() + 86400000) } },
      select: {
        staffMemberId: true,
        staffMember: { select: { storeId: true } },
      },
      orderBy: [{ nextPaymentDate: 'asc' }, { staffMemberId: 'asc' }],
      take: 500,
    });
    let processed = 0,
      skippedInactive = 0;
    for (const candidate of due) {
      const result = await this.prisma.$transaction(
        async (tx) => {
          await lockStaff(
            tx,
            candidate.staffMember.storeId,
            candidate.staffMemberId,
          );
          const profile = await tx.staffSalaryProfile.findUnique({
            where: { staffMemberId: candidate.staffMemberId },
            include: { staffMember: { select: { status: true } } },
          });
          if (
            !profile?.nextPaymentDate ||
            salaryDay(profile.nextPaymentDate) > today
          )
            return { processed: 0, skippedInactive: 0 };
          let date = salaryDay(profile.nextPaymentDate),
            count = 0,
            periods = 0;
          // Bound catch-up transactions; later invocations continue from the cursor.
          while (date <= today && periods < 366) {
            const existing = await findSalaryForDay(
              tx,
              profile.staffMemberId,
              date,
            );
            if (!existing) {
              const payment = await tx.staffSalaryPayment.create({
                data: {
                  staffMemberId: profile.staffMemberId,
                  amount: profile.baseSalary,
                  paymentDate: date,
                  scheduledFor: date,
                  status:
                    profile.expenseHandling === SalaryExpenseHandling.AUTOMATIC
                      ? SalaryPaymentStatus.PAID
                      : SalaryPaymentStatus.PENDING,
                  paidAt:
                    profile.expenseHandling === SalaryExpenseHandling.AUTOMATIC
                      ? new Date()
                      : null,
                  paymentMethod: profile.paymentMethod,
                  expenseHandling: profile.expenseHandling,
                  frequency: profile.frequency,
                  notes: profile.notes,
                },
                include: PAYMENT_INCLUDE,
              });
              if (profile.expenseHandling === SalaryExpenseHandling.AUTOMATIC)
                await this.linkExpense(
                  tx,
                  candidate.staffMember.storeId,
                  null,
                  payment,
                );
              count++;
            } else if (
              profile.expenseHandling === SalaryExpenseHandling.AUTOMATIC &&
              existing.status === SalaryPaymentStatus.PENDING
            ) {
              const paid = await tx.staffSalaryPayment.update({
                where: { id: existing.id },
                data: { status: SalaryPaymentStatus.PAID, paidAt: new Date() },
                include: PAYMENT_INCLUDE,
              });
              await this.linkExpense(
                tx,
                candidate.staffMember.storeId,
                null,
                paid,
              );
              count++;
            }
            date = advance(
              date,
              profile.frequency,
              profile.startDate.getUTCDate(),
            );
            periods++;
          }
          await tx.staffSalaryProfile.update({
            where: { id: profile.id },
            data: { nextPaymentDate: date },
          });
          return { processed: count, skippedInactive: 0 };
        },
        { timeout: 30000 },
      );
      processed += result.processed;
      skippedInactive += result.skippedInactive;
    }
    return { processed, skippedInactive };
  }

  async annualSummary(
    userId: string,
    staffId: string,
    query: SalaryAnnualQueryDto,
  ): Promise<SalaryAnnualSummaryDto> {
    const { storeId, baseCurrency } =
      await this.storeAccess.requireOwner(userId);
    const staff = await this.requireStaff(storeId, staffId);
    const year = query.year ?? new Date().getUTCFullYear();
    const from = new Date(Date.UTC(year, 0, 1)),
      to = new Date(Date.UTC(year + 1, 0, 1));
    const [payments, profile] = await Promise.all([
      this.prisma.staffSalaryPayment.findMany({
        where: {
          staffMemberId: staffId,
          OR: [
            { paymentDate: { gte: from, lt: to } },
            { paidAt: { gte: from, lt: to } },
          ],
        },
      }),
      this.prisma.staffSalaryProfile.findUnique({
        where: { staffMemberId: staffId },
      }),
    ]);
    let paid = new Prisma.Decimal(0),
      remaining = new Prisma.Decimal(0),
      count = 0,
      projected = false;
    const dates = new Set(
      payments.map((p) => salaryDay(p.scheduledFor ?? p.paymentDate).getTime()),
    );
    for (const p of payments) {
      if (
        p.status === SalaryPaymentStatus.PAID &&
        p.paidAt &&
        p.paidAt >= from &&
        p.paidAt < to
      )
        paid = paid.plus(p.amount);
      if (
        p.status === SalaryPaymentStatus.PENDING &&
        p.paymentDate >= from &&
        p.paymentDate < to
      ) {
        remaining = remaining.plus(p.amount);
        count++;
      }
    }
    if (profile?.nextPaymentDate) {
      let date = salaryDay(profile.nextPaymentDate);
      // Skip to requested year without iterating decades of daily occurrences.
      if (date < from && profile.frequency !== SalaryFrequency.MONTHLY) {
        const step =
          profile.frequency === SalaryFrequency.DAILY ? 86400000 : 604800000;
        date = new Date(
          date.getTime() +
            Math.ceil((from.getTime() - date.getTime()) / step) * step,
        );
      }
      while (date < to) {
        if (date >= from && !dates.has(date.getTime())) {
          remaining = remaining.plus(profile.baseSalary);
          count++;
          projected = true;
        }
        date = advance(date, profile.frequency, profile.startDate.getUTCDate());
      }
    }
    return {
      year,
      currency: baseCurrency,
      totalPaidThisYear: paid.toFixed(2),
      remainingPayments: count,
      remainingAmount: remaining.toFixed(2),
      annualTotal: paid.plus(remaining).toFixed(2),
      projected,
    };
  }

  private async requireStaff(storeId: string, staffId: string) {
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, storeId },
    });
    if (!staff) throw new NotFoundException('Staff member not found');
    return staff;
  }
}

export async function lockStaff(
  tx: Prisma.TransactionClient,
  storeId: string,
  staffId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "StaffMember" WHERE "id" = ${staffId} AND "storeId" = ${storeId} FOR UPDATE`;
  if (!rows.length) throw new NotFoundException('Staff member not found');
}

export function salaryProfileData(
  dto: SetSalaryProfileDto,
  existing?: StaffSalaryProfile | null,
) {
  const startDate = salaryDay(new Date(dto.startDate));
  const unchanged =
    existing && salaryDay(existing.startDate).getTime() === startDate.getTime();
  return {
    baseSalary: dto.baseSalary,
    frequency: dto.frequency,
    paymentMethod: dto.paymentMethod,
    expenseHandling:
      dto.expenseHandling ??
      existing?.expenseHandling ??
      SalaryExpenseHandling.AUTOMATIC,
    startDate,
    nextPaymentDate:
      unchanged && existing.nextPaymentDate
        ? existing.nextPaymentDate
        : startDate,
    notes: dto.notes ?? null,
  };
}

export function advance(
  date: Date,
  frequency: SalaryFrequency,
  anchorDay: number,
): Date {
  switch (frequency) {
    case SalaryFrequency.DAILY: {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 1);
      return next;
    }
    case SalaryFrequency.WEEKLY: {
      const next = new Date(date);
      next.setUTCDate(next.getUTCDate() + 7);
      return next;
    }
    case SalaryFrequency.MONTHLY:
      return addMonthClamped(date, anchorDay);
  }
}

function addMonthClamped(date: Date, anchorDay: number): Date {
  const firstOfTargetMonth = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth() + 1,
      1,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
  const lastDayOfTargetMonth = new Date(
    Date.UTC(
      firstOfTargetMonth.getUTCFullYear(),
      firstOfTargetMonth.getUTCMonth() + 1,
      0,
    ),
  ).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(anchorDay, lastDayOfTargetMonth));
  return firstOfTargetMonth;
}

export function toProfileResponse(
  profile: StaffSalaryProfile,
): SalaryProfileResponseDto {
  return {
    baseSalary: profile.baseSalary.toFixed(2),
    frequency: profile.frequency,
    paymentMethod: profile.paymentMethod,
    expenseHandling: profile.expenseHandling,
    startDate: profile.startDate.toISOString(),
    nextPaymentDate: profile.nextPaymentDate?.toISOString() ?? null,
    notes: profile.notes,
  };
}

function toPaymentResponse(
  p: Payment,
  now = new Date(),
): SalaryPaymentResponseDto {
  return {
    id: p.id,
    staffMemberId: p.staffMemberId,
    staffName: p.staffMember.name,
    photoUrl: p.staffMember.photoUrl,
    jobTitle: p.staffMember.jobTitle,
    amount: p.amount.toFixed(2),
    paymentDate: p.paymentDate.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    paymentMethod: p.paymentMethod,
    status: p.status,
    displayStatus: deriveSalaryDisplayStatus(p.status, p.paymentDate, now),
    notes: p.notes,
    receiptUrl: p.receiptUrl,
    frequency: p.frequency,
    nextPaymentDate:
      p.staffMember.salaryProfile?.nextPaymentDate?.toISOString() ?? null,
    expenseHandling: p.expenseHandling,
    expenseId: p.expenseId,
    expenseRecorded: !!p.expenseId,
  };
}
function displayStatusWhere(
  status: SalaryPaymentDisplayStatus | undefined,
  now: Date,
): Prisma.StaffSalaryPaymentWhereInput {
  if (!status) return {};
  if (status === 'PAID') return { status: SalaryPaymentStatus.PAID };
  return {
    status: SalaryPaymentStatus.PENDING,
    paymentDate:
      status === 'PENDING' ? { gte: salaryDay(now) } : { lt: salaryDay(now) },
  };
}

/** Include legacy records whose due-date key predates this migration. */
async function findSalaryForDay(
  tx: Prisma.TransactionClient,
  staffMemberId: string,
  day: Date,
) {
  const keyed = await tx.staffSalaryPayment.findUnique({
    where: { staffMemberId_scheduledFor: { staffMemberId, scheduledFor: day } },
    select: { id: true, status: true },
  });
  if (keyed) return keyed;
  return tx.staffSalaryPayment.findFirst({
    where: {
      staffMemberId,
      scheduledFor: null,
      paymentDate: { gte: day, lt: new Date(day.getTime() + 86400000) },
    },
    select: { id: true, status: true },
  });
}
