import { Injectable } from '@nestjs/common';
import { ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SenditOverviewQueryDto } from './dto/sendit-overview-query.dto';

const RETURN_STATUSES = [
  ShippingShipmentStatus.RETURN_PENDING,
  ShippingShipmentStatus.RETURN_IN_TRANSIT,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
] as const;

const RESOLVED_STATUSES = [
  ShippingShipmentStatus.DELIVERED,
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ...RETURN_STATUSES,
] as const;

@Injectable()
export class SenditOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string, query: SenditOverviewQueryDto) {
    const days = query.days ?? 7;
    const now = new Date();
    const from = startOfUtcDay(
      new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000),
    );

    const [statusGroups, deliveredRows, trendRows, cityGroups, latest] =
      await Promise.all([
        this.prisma.senditShipment.groupBy({
          by: ['normalizedStatus'],
          where: { userId },
          _count: { _all: true },
        }),
        this.prisma.senditShipment.findMany({
          where: {
            userId,
            events: {
              some: { normalizedStatus: ShippingShipmentStatus.DELIVERED },
            },
          },
          select: {
            providerCreatedAt: true,
            createdAt: true,
            events: {
              where: { normalizedStatus: ShippingShipmentStatus.DELIVERED },
              orderBy: { eventAt: 'asc' },
              take: 1,
              select: { eventAt: true },
            },
          },
        }),
        this.prisma.senditShipment.findMany({
          where: {
            userId,
            OR: [
              { providerCreatedAt: { gte: from, lte: now } },
              { createdAt: { gte: from, lte: now } },
              { events: { some: { eventAt: { gte: from, lte: now } } } },
            ],
          },
          select: {
            providerCreatedAt: true,
            createdAt: true,
            events: {
              where: { eventAt: { gte: from, lte: now } },
              orderBy: { eventAt: 'asc' },
              select: { normalizedStatus: true, eventAt: true },
            },
          },
        }),
        this.prisma.senditShipment.groupBy({
          by: ['city', 'normalizedStatus'],
          where: { userId, city: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.senditShipment.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
      ]);

    const counts = new Map(
      statusGroups.map((group) => [group.normalizedStatus, group._count._all]),
    );
    const totalShipments = sum(counts.values());
    const deliveredShipments =
      counts.get(ShippingShipmentStatus.DELIVERED) ?? 0;
    const returnedShipments = sum(
      RETURN_STATUSES.map((status) => counts.get(status) ?? 0),
    );
    const resolvedShipments = sum(
      RESOLVED_STATUSES.map((status) => counts.get(status) ?? 0),
    );
    const activeShipments = totalShipments - resolvedShipments;
    const deliveryDurations = deliveredRows
      .map((shipment) => {
        const createdAt = shipment.providerCreatedAt ?? shipment.createdAt;
        const deliveredAt = shipment.events[0]?.eventAt;
        return deliveredAt && deliveredAt >= createdAt
          ? (deliveredAt.getTime() - createdAt.getTime()) /
              (24 * 60 * 60 * 1000)
          : null;
      })
      .filter((duration): duration is number => duration !== null);

    return {
      period: {
        days,
        from: from.toISOString(),
        to: now.toISOString(),
        timezone: 'UTC' as const,
      },
      metrics: {
        totalShipments,
        activeShipments,
        deliveredShipments,
        returnedShipments,
        deliveredRate: percentage(deliveredShipments, resolvedShipments),
        returnRate: percentage(returnedShipments, totalShipments),
        averageDeliveryDays: deliveryDurations.length
          ? round2(sum(deliveryDurations) / deliveryDurations.length)
          : null,
      },
      statusBreakdown: Object.values(ShippingShipmentStatus).map((status) => ({
        status,
        count: counts.get(status) ?? 0,
      })),
      performance: performanceTrend(from, days, trendRows),
      topCities: topCities(cityGroups),
      dataUpdatedAt: latest?.updatedAt.toISOString() ?? null,
    };
  }
}

type TrendShipment = {
  providerCreatedAt: Date | null;
  createdAt: Date;
  events: Array<{
    normalizedStatus: ShippingShipmentStatus;
    eventAt: Date;
  }>;
};

function performanceTrend(from: Date, days: number, rows: TrendShipment[]) {
  const points = new Map<
    string,
    { date: string; shipmentCount: number; delivered: number; returned: number }
  >();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(from.getTime() + index * 24 * 60 * 60 * 1000);
    const key = utcDateKey(date);
    points.set(key, { date: key, shipmentCount: 0, delivered: 0, returned: 0 });
  }

  for (const shipment of rows) {
    const createdAt = shipment.providerCreatedAt ?? shipment.createdAt;
    const createdPoint = points.get(utcDateKey(createdAt));
    if (createdPoint) createdPoint.shipmentCount += 1;

    const delivered = shipment.events.find(
      (event) => event.normalizedStatus === ShippingShipmentStatus.DELIVERED,
    );
    const returned = shipment.events.find((event) =>
      RETURN_STATUSES.includes(
        event.normalizedStatus as (typeof RETURN_STATUSES)[number],
      ),
    );
    const deliveredPoint = delivered
      ? points.get(utcDateKey(delivered.eventAt))
      : undefined;
    if (deliveredPoint) deliveredPoint.delivered += 1;
    const returnedPoint = returned
      ? points.get(utcDateKey(returned.eventAt))
      : undefined;
    if (returnedPoint) returnedPoint.returned += 1;
  }

  return [...points.values()];
}

function topCities(
  groups: Array<{
    city: string | null;
    normalizedStatus: ShippingShipmentStatus;
    _count: { _all: number };
  }>,
) {
  const cities = new Map<string, { shipments: number; delivered: number }>();
  for (const group of groups) {
    const city = group.city?.trim();
    if (!city) continue;
    const current = cities.get(city) ?? { shipments: 0, delivered: 0 };
    current.shipments += group._count._all;
    if (group.normalizedStatus === ShippingShipmentStatus.DELIVERED) {
      current.delivered += group._count._all;
    }
    cities.set(city, current);
  }

  return [...cities.entries()]
    .map(([city, metrics]) => ({
      city,
      shipments: metrics.shipments,
      delivered: metrics.delivered,
      deliveryRate: percentage(metrics.delivered, metrics.shipments),
    }))
    .sort(
      (left, right) =>
        right.shipments - left.shipments || left.city.localeCompare(right.city),
    )
    .slice(0, 5);
}

function startOfUtcDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? round2((numerator / denominator) * 100) : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: Iterable<number>) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
