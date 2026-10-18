import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { StoreAccessService } from '../access/store-access.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireWhatsAppOwner } from './whatsapp-access.util';
import { WhatsAppBalanceService } from './whatsapp-balance.service';
import {
  WHATSAPP_TRIGGERS,
  renderTemplateBody,
  templateDefinitionByName,
  templateVariables,
  type WhatsAppLanguage,
} from './whatsapp.constants';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 366;

// Reached Meta and were charged (status can advance past SENT afterwards).
const SENT_STATUSES: WhatsAppMessageStatus[] = [
  WhatsAppMessageStatus.SENT,
  WhatsAppMessageStatus.DELIVERED,
  WhatsAppMessageStatus.READ,
];

export interface MessagesQuery {
  status?: WhatsAppMessageStatus;
  trigger?: string;
  page: number;
  limit: number;
}

@Injectable()
export class WhatsAppInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeAccess: StoreAccessService,
    private readonly balance: WhatsAppBalanceService,
  ) {}

  async dashboard(userId: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const currency = access.baseCurrency;
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);

    const [connection, balance, price, today, scheduled] = await Promise.all([
      this.prisma.whatsAppConnection.findUnique({
        where: { storeId: access.storeId },
        select: { status: true },
      }),
      this.balance.getBalance(access.storeId, currency),
      this.balance.getPrice(currency),
      this.statusCounts(access.storeId, dayStart, new Date()),
      this.prisma.whatsAppMessage.count({
        where: {
          storeId: access.storeId,
          status: WhatsAppMessageStatus.SCHEDULED,
        },
      }),
    ]);

    return {
      connectionStatus: connection?.status ?? null,
      connected: connection?.status === WhatsAppConnectionStatus.ACTIVE,
      balance: balance.toFixed(2),
      currency,
      pricePerMessage: price?.toFixed(2) ?? null,
      messagesRemaining:
        price && !price.isZero()
          ? balance.dividedToIntegerBy(price).toNumber()
          : null,
      lowBalance: price
        ? balance.lessThan(this.balance.lowBalanceThreshold(price))
        : false,
      scheduled,
      today: {
        sent: today.sent,
        delivered: today.delivered,
        read: today.read,
        failed: today.failed,
        cost: today.cost,
      },
    };
  }

  async balanceHistory(userId: string, page: number, limit: number) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    return this.balance.history(access.storeId, page, limit);
  }

  async messages(userId: string, query: MessagesQuery) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    if (
      query.trigger &&
      !(WHATSAPP_TRIGGERS as readonly string[]).includes(query.trigger)
    ) {
      throw new BadRequestException(
        `trigger must be one of ${WHATSAPP_TRIGGERS.join(', ')}`,
      );
    }
    const where: Prisma.WhatsAppMessageWhereInput = {
      storeId: access.storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.trigger
        ? { trigger: query.trigger as (typeof WHATSAPP_TRIGGERS)[number] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { order: { select: { id: true, orderName: true } } },
      }),
      this.prisma.whatsAppMessage.count({ where }),
    ]);

    return {
      data: rows.map((m) => {
        const variables = templateVariables(m.variables);
        const body =
          templateDefinitionByName(m.templateName)?.bodies[
            m.language as WhatsAppLanguage
          ] ?? null;
        return {
          id: m.id,
          trigger: m.trigger,
          status: m.status,
          recipientPhone: m.recipientPhone || null,
          templateName: m.templateName,
          language: m.language,
          text: body ? renderTemplateBody(body, variables) : null,
          order: m.order
            ? { id: m.order.id, orderName: m.order.orderName }
            : null,
          cost: m.cost?.toFixed(2) ?? null,
          currency: m.currency,
          errorCode: m.errorCode,
          errorMessage: m.errorMessage,
          sendAfter: m.sendAfter.toISOString(),
          sentAt: m.sentAt?.toISOString() ?? null,
          deliveredAt: m.deliveredAt?.toISOString() ?? null,
          readAt: m.readAt?.toISOString() ?? null,
          failedAt: m.failedAt?.toISOString() ?? null,
          createdAt: m.createdAt.toISOString(),
        };
      }),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async analytics(userId: string, from?: string, to?: string) {
    const access = await requireWhatsAppOwner(this.storeAccess, userId);
    const end = to ? parseDate(to, 'to') : new Date();
    const start = from
      ? parseDate(from, 'from')
      : new Date(end.getTime() - 30 * DAY_MS);
    if (start >= end) {
      throw new BadRequestException('from must be before to');
    }
    if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `The range can cover at most ${MAX_RANGE_DAYS} days`,
      );
    }

    const [totals, byTrigger, daily] = await Promise.all([
      this.statusCounts(access.storeId, start, end),
      this.prisma.whatsAppMessage.groupBy({
        by: ['trigger', 'status'],
        where: { storeId: access.storeId, createdAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        Array<{
          day: Date;
          sent: bigint;
          delivered: bigint;
          failed: bigint;
          cost: Prisma.Decimal | null;
        }>
      >`
        SELECT date_trunc('day', "createdAt") AS day,
          COUNT(*) FILTER (WHERE "status" IN ('SENT','DELIVERED','READ')) AS sent,
          COUNT(*) FILTER (WHERE "status" IN ('DELIVERED','READ')) AS delivered,
          COUNT(*) FILTER (WHERE "status" = 'FAILED') AS failed,
          SUM("cost") FILTER (WHERE "status" IN ('SENT','DELIVERED','READ')) AS cost
        FROM "WhatsAppMessage"
        WHERE "storeId" = ${access.storeId}
          AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY 1 ORDER BY 1`,
    ]);

    const triggers = WHATSAPP_TRIGGERS.map((trigger) => {
      const rows = byTrigger.filter((r) => r.trigger === trigger);
      const count = (statuses: WhatsAppMessageStatus[]) =>
        rows
          .filter((r) => statuses.includes(r.status))
          .reduce((sum, r) => sum + r._count._all, 0);
      return {
        trigger,
        sent: count(SENT_STATUSES),
        delivered: count([
          WhatsAppMessageStatus.DELIVERED,
          WhatsAppMessageStatus.READ,
        ]),
        failed: count([WhatsAppMessageStatus.FAILED]),
        skipped: count([WhatsAppMessageStatus.SKIPPED]),
      };
    });

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      currency: access.baseCurrency,
      totals: {
        ...totals,
        deliveryRate:
          totals.sent > 0
            ? Math.round((totals.delivered / totals.sent) * 1000) / 10
            : null,
        readRate:
          totals.sent > 0
            ? Math.round((totals.read / totals.sent) * 1000) / 10
            : null,
      },
      byTrigger: triggers,
      daily: daily.map((d) => ({
        date: d.day.toISOString().slice(0, 10),
        sent: Number(d.sent),
        delivered: Number(d.delivered),
        failed: Number(d.failed),
        cost: (d.cost ?? new Prisma.Decimal(0)).toFixed(2),
      })),
    };
  }

  private async statusCounts(storeId: string, start: Date, end: Date) {
    const where = { storeId, createdAt: { gte: start, lt: end } };
    const [grouped, cost] = await Promise.all([
      this.prisma.whatsAppMessage.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.whatsAppMessage.aggregate({
        where: { ...where, status: { in: SENT_STATUSES } },
        _sum: { cost: true },
      }),
    ]);
    const n = (status: WhatsAppMessageStatus) =>
      grouped.find((g) => g.status === status)?._count._all ?? 0;
    const delivered = n(WhatsAppMessageStatus.DELIVERED);
    const read = n(WhatsAppMessageStatus.READ);
    return {
      sent: n(WhatsAppMessageStatus.SENT) + delivered + read,
      delivered: delivered + read,
      read,
      failed: n(WhatsAppMessageStatus.FAILED),
      skipped: n(WhatsAppMessageStatus.SKIPPED),
      cost: (cost._sum.cost ?? new Prisma.Decimal(0)).toFixed(2),
    };
  }
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} must be an ISO 8601 date`);
  }
  return date;
}
