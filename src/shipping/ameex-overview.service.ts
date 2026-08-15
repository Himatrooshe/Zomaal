import { Injectable } from '@nestjs/common';
import { ShippingShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AmeexOverviewQueryDto } from './dto/ameex-overview-query.dto';

const RETURN_STATUSES = [
  ShippingShipmentStatus.RETURN_PENDING,
  ShippingShipmentStatus.RETURN_IN_TRANSIT,
  ShippingShipmentStatus.RETURNED_TO_WAREHOUSE,
  ShippingShipmentStatus.RETURN_INSPECTION,
  ShippingShipmentStatus.RETURNED_TO_STOCK,
  ShippingShipmentStatus.RETURNED_TO_SELLER,
] as const;

const RESOLVED = [
  ShippingShipmentStatus.DELIVERED,
  ShippingShipmentStatus.CANCELLED,
  ShippingShipmentStatus.REFUSED,
  ...RETURN_STATUSES,
] as const;

@Injectable()
export class AmeexOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(userId: string, query: AmeexOverviewQueryDto) {
    const days = query.days ?? 7;
    const now = new Date();
    const from = startDay(new Date(now.getTime() - (days - 1) * 86_400_000));
    const [groups, deliveredRows, rows, cityGroups, latest, connection] =
      await Promise.all([
        this.prisma.ameexShipment.groupBy({
          by: ['normalizedStatus'],
          where: { userId },
          _count: { _all: true },
        }),
        this.prisma.ameexShipment.findMany({
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
        this.prisma.ameexShipment.findMany({
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
              select: { normalizedStatus: true, eventAt: true },
            },
          },
        }),
        this.prisma.ameexShipment.groupBy({
          by: ['city', 'normalizedStatus'],
          where: { userId, city: { not: null } },
          _count: { _all: true },
        }),
        this.prisma.ameexShipment.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
          select: { updatedAt: true },
        }),
        this.prisma.ameexConnection.findUnique({
          where: { userId },
          select: { lastSyncedAt: true, lastSyncError: true },
        }),
      ]);
    const counts = new Map(
      groups.map((group) => [group.normalizedStatus, group._count._all]),
    );
    const total = sum(counts.values());
    const delivered = counts.get(ShippingShipmentStatus.DELIVERED) ?? 0;
    const returned = sum(
      RETURN_STATUSES.map((status) => counts.get(status) ?? 0),
    );
    const resolved = sum(RESOLVED.map((status) => counts.get(status) ?? 0));
    const deliveryDurations = deliveredRows
      .map((shipment) => {
        const createdAt = shipment.providerCreatedAt ?? shipment.createdAt;
        const deliveredAt = shipment.events[0]?.eventAt;
        return deliveredAt && deliveredAt >= createdAt
          ? (deliveredAt.getTime() - createdAt.getTime()) / 86_400_000
          : null;
      })
      .filter((value): value is number => value !== null);
    return {
      period: {
        days,
        from: from.toISOString(),
        to: now.toISOString(),
        timezone: 'UTC' as const,
      },
      metrics: {
        totalShipments: total,
        activeShipments: total - resolved,
        deliveredShipments: delivered,
        returnedShipments: returned,
        deliveredRate: percentage(delivered, resolved),
        returnRate: percentage(returned, total),
        averageDeliveryDays: deliveryDurations.length
          ? round2(sum(deliveryDurations) / deliveryDurations.length)
          : null,
      },
      statusBreakdown: Object.values(ShippingShipmentStatus).map((status) => ({
        status,
        count: counts.get(status) ?? 0,
      })),
      performance: trend(from, days, rows),
      topCities: cities(cityGroups),
      dataUpdatedAt: latest?.updatedAt.toISOString() ?? null,
      sync: {
        lastSyncedAt: connection?.lastSyncedAt?.toISOString() ?? null,
        lastSyncError: connection?.lastSyncError ?? null,
      },
    };
  }
}

function trend(
  from: Date,
  days: number,
  rows: Array<{
    providerCreatedAt: Date | null;
    createdAt: Date;
    events: Array<{ normalizedStatus: ShippingShipmentStatus; eventAt: Date }>;
  }>,
) {
  const points = new Map<
    string,
    { date: string; shipmentCount: number; delivered: number; returned: number }
  >();
  for (let index = 0; index < days; index += 1) {
    const date = key(new Date(from.getTime() + index * 86_400_000));
    points.set(date, { date, shipmentCount: 0, delivered: 0, returned: 0 });
  }
  rows.forEach((row) => {
    const created = points.get(key(row.providerCreatedAt ?? row.createdAt));
    if (created) created.shipmentCount += 1;
    row.events.forEach((event) => {
      const point = points.get(key(event.eventAt));
      if (!point) return;
      if (event.normalizedStatus === ShippingShipmentStatus.DELIVERED) {
        point.delivered += 1;
      }
      if (
        RETURN_STATUSES.includes(
          event.normalizedStatus as (typeof RETURN_STATUSES)[number],
        )
      ) {
        point.returned += 1;
      }
    });
  });
  return [...points.values()];
}

function cities(
  groups: Array<{
    city: string | null;
    normalizedStatus: ShippingShipmentStatus;
    _count: { _all: number };
  }>,
) {
  const values = new Map<string, { shipments: number; delivered: number }>();
  groups.forEach((group) => {
    if (!group.city) return;
    const value = values.get(group.city) ?? { shipments: 0, delivered: 0 };
    value.shipments += group._count._all;
    if (group.normalizedStatus === ShippingShipmentStatus.DELIVERED) {
      value.delivered += group._count._all;
    }
    values.set(group.city, value);
  });
  return [...values.entries()]
    .map(([city, value]) => ({
      city,
      ...value,
      deliveryRate: percentage(value.delivered, value.shipments),
    }))
    .sort((a, b) => b.shipments - a.shipments)
    .slice(0, 5);
}

function startDay(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function key(value: Date) {
  return value.toISOString().slice(0, 10);
}

function percentage(value: number, total: number) {
  return total ? Math.round((value / total) * 10_000) / 100 : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: Iterable<number>) {
  let total = 0;
  for (const value of values) total += value;
  return total;
}
