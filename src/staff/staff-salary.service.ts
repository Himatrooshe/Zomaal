import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExpensePaymentMethod,
  Prisma,
  SalaryExpenseHandling,
  SalaryFrequency,
  SalaryPaymentMethod,
  SalaryPaymentStatus,
  StaffStatus,
  type StaffSalaryPayment,
  type StaffSalaryProfile,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import { attachReceipt, receiptPreviewPath } from '../common/media/attach-receipt.util';
import { calculateTrend, lastNMonthKeys, monthKey, monthsAgoStart } from '../common/trend.util';
import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../common/dto/monthly-trend.dto';
import {
  CreateSalaryPaymentDto,
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
  type SalaryPaymentDisplayStatus,
} from './salary-payment-status.util';

const SALARY_PAYMENT_METHOD_TO_EXPENSE: Record<SalaryPaymentMethod, ExpensePaymentMethod> = {
  BANK_TRANSFER: ExpensePaymentMethod.BANK,
  CASH: ExpensePaymentMethod.CASH,
};

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
    await this.requireStaff(storeId, staffId);

    const startDate = new Date(dto.startDate);
    const expenseHandling = dto.expenseHandling ?? SalaryExpenseHandling.AUTOMATIC;

    const existing = await this.prisma.staffSalaryProfile.findUnique({
      where: { staffMemberId: staffId },
    });

    const profile = await this.prisma.staffSalaryProfile.upsert({
      where: { staffMemberId: staffId },
      create: {
        staffMemberId: staffId,
        baseSalary: dto.baseSalary,
        frequency: dto.frequency,
        paymentMethod: dto.paymentMethod,
        expenseHandling,
        startDate,
        // First automatic payment is due on the schedule's own start date.
        nextPaymentDate: expenseHandling === SalaryExpenseHandling.AUTOMATIC ? startDate : null,
        notes: dto.notes ?? null,
      },
      update: {
        baseSalary: dto.baseSalary,
        frequency: dto.frequency,
        paymentMethod: dto.paymentMethod,
        expenseHandling,
        startDate,
        notes: dto.notes,
        nextPaymentDate:
          expenseHandling === SalaryExpenseHandling.AUTOMATIC
            ? resolveNextPaymentDateOnUpdate(existing, startDate)
            : // Switching to MANUAL clears the schedule — a human is now
              // responsible for every entry.
              null,
      },
    });

    return toProfileResponse(profile);
  }

  async listPayments(
    userId: string,
    staffId: string,
    query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const staff = await this.requireStaff(storeId, staffId);
    return this.listPaymentsForWhere(
      { staffMemberId: staffId },
      query,
      () => staff.name,
    );
  }

  /** Store-wide salary payment history (Staff salary tab filters). */
  async listStorePayments(
    userId: string,
    query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    return this.listPaymentsForWhere(
      { staffMember: { storeId } },
      query,
      (payment) =>
        (payment as StaffSalaryPayment & { staffMember?: { name: string } }).staffMember
          ?.name ?? '',
      true,
    );
  }

  async summary(userId: string): Promise<SalarySummaryResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const [paidAgg, unpaid] = await Promise.all([
      this.prisma.staffSalaryPayment.aggregate({
        where: {
          staffMember: { storeId },
          status: SalaryPaymentStatus.PAID,
        },
        _sum: { amount: true },
      }),
      this.prisma.staffSalaryPayment.findMany({
        where: {
          staffMember: { storeId },
          status: SalaryPaymentStatus.PENDING,
        },
        select: { amount: true },
      }),
    ]);

    let pendingTotal = new Prisma.Decimal(0);
    for (const row of unpaid) {
      pendingTotal = pendingTotal.plus(row.amount);
    }

    return {
      totalSalaryPaid: (paidAgg._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      pendingPaymentCount: unpaid.length,
      pendingPaymentsTotal: pendingTotal.toFixed(2),
    };
  }

  private async listPaymentsForWhere(
    baseWhere: Prisma.StaffSalaryPaymentWhereInput,
    query: SalaryPaymentListQueryDto,
    resolveName: (payment: StaffSalaryPayment) => string,
    includeStaff = false,
  ): Promise<SalaryPaymentListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const now = new Date();
    const where = {
      ...baseWhere,
      ...displayStatusWhere(query.status, now),
    };

    const [payments, total] = await Promise.all([
      this.prisma.staffSalaryPayment.findMany({
        where,
        orderBy: { paymentDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        ...(includeStaff
          ? { include: { staffMember: { select: { name: true } } } }
          : {}),
      }),
      this.prisma.staffSalaryPayment.count({ where }),
    ]);

    return {
      payments: payments.map((p) =>
        toPaymentResponse(p, resolveName(p), now),
      ),
      total,
      page,
      limit,
    };
  }

  /** Monthly payout totals across all staff (Salary bar chart). */
  async trend(userId: string, query: MonthlyTrendQueryDto): Promise<MonthlyTrendResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);
    const months = query.months ?? 6;
    const keys = lastNMonthKeys(months);
    const since = monthsAgoStart(months);

    const payments = await this.prisma.staffSalaryPayment.findMany({
      where: { staffMember: { storeId }, paymentDate: { gte: since } },
      select: { amount: true, paymentDate: true },
    });

    const totals = new Map<string, Prisma.Decimal>();
    for (const payment of payments) {
      const key = monthKey(payment.paymentDate);
      totals.set(key, (totals.get(key) ?? new Prisma.Decimal(0)).plus(payment.amount));
    }

    const points = keys.map((month) => ({
      month,
      total: (totals.get(month) ?? new Prisma.Decimal(0)).toFixed(2),
    }));

    const current = Number(points[points.length - 1]?.total ?? 0);
    const previous = Number(points[points.length - 2]?.total ?? 0);

    return { points, trend: calculateTrend(current, previous) };
  }

  /**
   * Manual salary entry (Add Salary Record: choose staff, then enter the
   * payment). Blocked per staff member whose profile is AUTOMATIC — that
   * person's salary is generated by runAutomaticPayments instead, and
   * letting both paths write would double-count the expense.
   */
  async createPayments(
    userId: string,
    dto: CreateSalaryPaymentDto,
  ): Promise<SalaryPaymentBatchResponseDto> {
    const { storeId } = await this.storeAccess.requireOwner(userId);

    const staffMembers = await this.prisma.staffMember.findMany({
      where: { id: { in: dto.staffMemberIds }, storeId },
      include: { salaryProfile: true },
    });

    const foundIds = new Set(staffMembers.map((s) => s.id));
    const missing = dto.staffMemberIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Staff member(s) not found: ${missing.join(', ')}`);
    }

    const automatic = staffMembers.filter(
      (s) => s.salaryProfile?.expenseHandling === SalaryExpenseHandling.AUTOMATIC,
    );
    if (automatic.length > 0) {
      throw new ConflictException(
        `Manual salary entry is blocked while automatic is on for: ${automatic
          .map((s) => s.name)
          .join(', ')}`,
      );
    }

    const missingAmount = !dto.amount;
    const noProfileNoAmount = staffMembers.filter(
      (s) => missingAmount && !s.salaryProfile,
    );
    if (noProfileNoAmount.length > 0) {
      throw new BadRequestException(
        `Amount is required for staff with no salary profile set: ${noProfileNoAmount
          .map((s) => s.name)
          .join(', ')}`,
      );
    }

    const categoryId = await this.resolveSalaryCategoryId(storeId);
    const paymentDate = new Date(dto.paymentDate);

    const payments = await this.prisma.$transaction(async (tx) => {
      const created = await Promise.all(
        staffMembers.map((staff, index) => {
          const amount = dto.amount ?? staff.salaryProfile!.baseSalary.toString();
          return tx.staffSalaryPayment.create({
            data: {
              staffMember: { connect: { id: staff.id } },
              amount,
              paymentDate,
              paidAt: new Date(),
              paymentMethod: dto.paymentMethod,
              status: SalaryPaymentStatus.PAID,
              notes: dto.notes ?? null,
              // One receipt (e.g. a single bank-transfer batch confirmation)
              // commonly covers the whole batch, but the schema is 1 receipt
              // : 1 payment. Rather than duplicate the upload across every
              // payment, attach it to the first one only — the others in the
              // batch are still clearly linked by shared paymentDate/notes.
              receiptUrl:
                dto.receiptAssetId && index === 0
                  ? receiptPreviewPath(dto.receiptAssetId)
                  : (dto.receiptUrl ?? null),
              expense: {
                create: {
                  storeId,
                  title: `Salary — ${staff.name}`,
                  amount,
                  paymentMethod: SALARY_PAYMENT_METHOD_TO_EXPENSE[dto.paymentMethod],
                  spentAt: paymentDate,
                  categoryId,
                  staffMemberId: staff.id,
                  createdByUserId: userId,
                },
              },
            },
          });
        }),
      );

      if (dto.receiptAssetId) {
        await attachReceipt(tx, storeId, dto.receiptAssetId, {
          salaryPaymentId: created[0].id,
        });
      }

      return created;
    });

    return {
      payments: payments.map((p, i) => toPaymentResponse(p, staffMembers[i].name)),
    };
  }

  /**
   * Called only by the internal scheduler (staff-salary-scheduler.controller)
   * — processes every AUTOMATIC profile whose nextPaymentDate has arrived,
   * across every store. One period per run; a run that fires at least as
   * often as the shortest frequency (DAILY) never falls behind.
   */
  async runAutomaticPayments(): Promise<{ processed: number; skippedInactive: number }> {
    const due = await this.prisma.staffSalaryProfile.findMany({
      where: {
        expenseHandling: SalaryExpenseHandling.AUTOMATIC,
        nextPaymentDate: { lte: new Date() },
      },
      include: { staffMember: { select: { id: true, name: true, storeId: true, status: true } } },
    });

    let processed = 0;
    let skippedInactive = 0;
    for (const profile of due) {
      const paymentDate = profile.nextPaymentDate!;
      const nextPaymentDate = advance(paymentDate, profile.frequency, profile.startDate.getUTCDate());

      // A deactivated staff member's automatic schedule must still tick
      // forward — leaving nextPaymentDate frozen in the past would, on
      // reactivation, suddenly generate a back-dated payment for a period
      // they were inactive for the whole time. Advance without paying.
      if (profile.staffMember.status !== StaffStatus.ACTIVE) {
        await this.prisma.staffSalaryProfile.update({
          where: { id: profile.id },
          data: { nextPaymentDate },
        });
        skippedInactive += 1;
        continue;
      }

      const categoryId = await this.resolveSalaryCategoryId(profile.staffMember.storeId);

      await this.prisma.staffSalaryPayment.create({
        data: {
          staffMember: { connect: { id: profile.staffMemberId } },
          amount: profile.baseSalary,
          paymentDate,
          paidAt: new Date(),
          paymentMethod: profile.paymentMethod,
          status: SalaryPaymentStatus.PAID,
          expense: {
            create: {
              storeId: profile.staffMember.storeId,
              title: `Salary — ${profile.staffMember.name}`,
              amount: profile.baseSalary,
              paymentMethod: SALARY_PAYMENT_METHOD_TO_EXPENSE[profile.paymentMethod],
              spentAt: paymentDate,
              categoryId,
              staffMemberId: profile.staffMemberId,
            },
          },
        },
      });

      await this.prisma.staffSalaryProfile.update({
        where: { id: profile.id },
        data: { nextPaymentDate },
      });

      processed += 1;
    }

    return { processed, skippedInactive };
  }

  private async requireStaff(storeId: string, staffId: string) {
    const staff = await this.prisma.staffMember.findFirst({
      where: { id: staffId, storeId },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found');
    }
    return staff;
  }

  private async resolveSalaryCategoryId(storeId: string): Promise<string> {
    const existing = await this.prisma.expenseCategory.findFirst({
      where: { storeId, group: 'SALARY' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await this.prisma.expenseCategory.create({
      data: { storeId, name: 'Salaries', group: 'SALARY', isSystem: true },
      select: { id: true },
    });
    return created.id;
  }
}

/**
 * `anchorDay` is the day-of-month the schedule is meant to land on — the
 * profile's original startDate, NOT the previous payment's date. Deriving
 * the anchor from the previous payment instead would permanently drift a
 * schedule once it's clamped by a short month (Jan 31 -> Feb 28 -> Mar 28
 * forever, since 28 becomes the new "day"). Anchoring to startDate instead
 * gives Jan 31 -> Feb 28 -> Mar 31 -> Apr 30 -> May 31 — it returns to the
 * 31st every time a long-enough month comes back around.
 */
function resolveNextPaymentDateOnUpdate(
  existing: StaffSalaryProfile | null,
  newStartDate: Date,
): Date {
  // No profile yet, or it was MANUAL (nextPaymentDate already null): the
  // schedule starts fresh from the (possibly just-set) startDate.
  if (!existing || existing.nextPaymentDate === null) {
    return newStartDate;
  }
  // Already AUTOMATIC and startDate hasn't changed: this is an edit to some
  // other field (baseSalary, notes, ...) — leave the running schedule alone
  // rather than resetting it back to startDate on every unrelated save.
  if (existing.startDate.getTime() === newStartDate.getTime()) {
    return existing.nextPaymentDate;
  }
  // startDate was deliberately changed while already AUTOMATIC: honor it.
  return newStartDate;
}
export function advance(date: Date, frequency: SalaryFrequency, anchorDay: number): Date {
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
    Date.UTC(firstOfTargetMonth.getUTCFullYear(), firstOfTargetMonth.getUTCMonth() + 1, 0),
  ).getUTCDate();
  firstOfTargetMonth.setUTCDate(Math.min(anchorDay, lastDayOfTargetMonth));
  return firstOfTargetMonth;
}

function toProfileResponse(profile: StaffSalaryProfile): SalaryProfileResponseDto {
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
  payment: StaffSalaryPayment,
  staffName: string,
  now: Date = new Date(),
): SalaryPaymentResponseDto {
  return {
    id: payment.id,
    staffMemberId: payment.staffMemberId,
    staffName,
    amount: payment.amount.toFixed(2),
    paymentDate: payment.paymentDate.toISOString(),
    paidAt: payment.paidAt?.toISOString() ?? null,
    paymentMethod: payment.paymentMethod,
    status: payment.status,
    displayStatus: deriveSalaryDisplayStatus(
      payment.status,
      payment.paymentDate,
      now,
    ),
    notes: payment.notes,
    receiptUrl: payment.receiptUrl,
  };
}

function displayStatusWhere(
  status: SalaryPaymentDisplayStatus | undefined,
  now: Date,
): Prisma.StaffSalaryPaymentWhereInput {
  if (!status) return {};
  if (status === 'PAID') {
    return { status: SalaryPaymentStatus.PAID };
  }
  if (status === 'PENDING') {
    return {
      status: SalaryPaymentStatus.PENDING,
      paymentDate: { gte: now },
    };
  }
  // OVERDUE
  return {
    status: SalaryPaymentStatus.PENDING,
    paymentDate: { lt: now },
  };
}
