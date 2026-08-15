import { Injectable } from '@nestjs/common';
import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ShippingHomeQueryDto } from './dto/shipping-home.dto';

type CostGroup = {
  normalizedStatus: ShippingShipmentStatus;
  _count: { _all: number; fee: number };
  _sum: { fee: Prisma.Decimal | null };
};

const PICKUP_STATUSES = [
  ShippingShipmentStatus.PICKUP_PENDING,
  ShippingShipmentStatus.PICKED_UP,
] as const;

@Injectable()
export class ShippingDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getHome(userId: string, query: ShippingHomeQueryDto) {
    const days = query.days ?? 1;
    const now = new Date();
    const from = startOfUtcDay(
      new Date(now.getTime() - (days - 1) * 86_400_000),
    );
    const dateWhere = {
      OR: [
        { providerCreatedAt: { gte: from, lte: now } },
        {
          providerCreatedAt: null,
          createdAt: { gte: from, lte: now },
        },
      ],
    };

    const [
      senditGroups,
      quickGroups,
      forceLogGroups,
      ozoneGroups,
      ameexGroups,
      latestSendit,
      latestQuick,
      latestForceLog,
      latestOzone,
      latestAmeex,
    ] = await Promise.all([
      this.prisma.senditShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId, ...dateWhere },
        _count: { _all: true, fee: true },
        _sum: { fee: true },
      }),
      this.prisma.quickLivraisonShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId, ...dateWhere },
        _count: { _all: true, fee: true },
        _sum: { fee: true },
      }),
      this.prisma.forceLogShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId, ...dateWhere },
        _count: { _all: true, fee: true },
        _sum: { fee: true },
      }),
      this.prisma.ozoneExpressShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId, ...dateWhere },
        _count: { _all: true, fee: true },
        _sum: { fee: true },
      }),
      this.prisma.ameexShipment.groupBy({
        by: ['normalizedStatus'],
        where: { userId, ...dateWhere },
        _count: { _all: true, fee: true },
        _sum: { fee: true },
      }),
      this.prisma.senditShipment.findFirst({
        where: { userId, ...dateWhere },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.quickLivraisonShipment.findFirst({
        where: { userId, ...dateWhere },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.forceLogShipment.findFirst({
        where: { userId, ...dateWhere },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.ozoneExpressShipment.findFirst({
        where: { userId, ...dateWhere },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
      this.prisma.ameexShipment.findFirst({
        where: { userId, ...dateWhere },
        orderBy: { updatedAt: 'desc' },
        select: { updatedAt: true },
      }),
    ]);

    const sendit = providerCost('sendit', senditGroups);
    const quickLivraison = providerCost('quicklivraison', quickGroups);
    const forceLog = providerCost('forcelog', forceLogGroups);
    const ozoneExpress = providerCost('ozoneexpress', ozoneGroups);
    const ameex = providerCost('ameex', ameexGroups);
    const groups = [
      ...senditGroups,
      ...quickGroups,
      ...forceLogGroups,
      ...ozoneGroups,
      ...ameexGroups,
    ];
    const total = costMetric(groups);
    const latest = latestDate(
      latestSendit?.updatedAt ?? null,
      latestQuick?.updatedAt ?? null,
      latestForceLog?.updatedAt ?? null,
      latestOzone?.updatedAt ?? null,
      latestAmeex?.updatedAt ?? null,
    );

    return {
      period: {
        days,
        from: from.toISOString(),
        to: now.toISOString(),
        timezone: 'UTC' as const,
      },
      currency: 'MAD' as const,
      totalShippingCost: total.cost,
      averageShippingCostPerPricedShipment: total.pricedShipments
        ? money(new Prisma.Decimal(total.cost).dividedBy(total.pricedShipments))
        : null,
      totalShipments: total.shipments,
      pricedShipments: total.pricedShipments,
      costCoveragePercentage: percentage(
        total.pricedShipments,
        total.shipments,
      ),
      delivery: costMetric(groups, [ShippingShipmentStatus.DELIVERED]),
      cancelled: costMetric(groups, [ShippingShipmentStatus.CANCELLED]),
      refused: costMetric(groups, [ShippingShipmentStatus.REFUSED]),
      pickup: costMetric(groups, [...PICKUP_STATUSES]),
      providers: [sendit, quickLivraison, forceLog, ozoneExpress, ameex],
      dataUpdatedAt: latest?.toISOString() ?? null,
    };
  }
}

function providerCost(
  provider: 'sendit' | 'quicklivraison' | 'forcelog' | 'ozoneexpress' | 'ameex',
  groups: CostGroup[],
) {
  return { provider, ...costMetric(groups) };
}

function costMetric(groups: CostGroup[], statuses?: ShippingShipmentStatus[]) {
  const selected = statuses
    ? groups.filter((group) => statuses.includes(group.normalizedStatus))
    : groups;
  const cost = selected.reduce(
    (total, group) => total.plus(group._sum.fee ?? 0),
    new Prisma.Decimal(0),
  );
  return {
    cost: money(cost),
    shipments: selected.reduce((total, group) => total + group._count._all, 0),
    pricedShipments: selected.reduce(
      (total, group) => total + group._count.fee,
      0,
    ),
  };
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function latestDate(...values: Array<Date | null>) {
  return values.reduce<Date | null>(
    (latest, value) => (value && (!latest || value > latest) ? value : latest),
    null,
  );
}

function money(value: Prisma.Decimal) {
  return value.toDecimalPlaces(4).toFixed(4);
}

function percentage(numerator: number, denominator: number) {
  return denominator
    ? Math.round(((numerator / denominator) * 100 + Number.EPSILON) * 100) / 100
    : 0;
}
