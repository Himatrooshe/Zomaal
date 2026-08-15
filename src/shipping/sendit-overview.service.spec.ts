import { ShippingShipmentStatus } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { SenditOverviewService } from './sendit-overview.service';

describe('SenditOverviewService', () => {
  const groupBy = jest.fn();
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const prisma = {
    senditShipment: { groupBy, findMany, findFirst },
  } as unknown as PrismaService;
  const service = new SenditOverviewService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns stable KPIs, daily performance, and top-city analytics', async () => {
    groupBy
      .mockResolvedValueOnce([
        statusGroup(ShippingShipmentStatus.DELIVERED, 80),
        statusGroup(ShippingShipmentStatus.CANCELLED, 5),
        statusGroup(ShippingShipmentStatus.REFUSED, 5),
        statusGroup(ShippingShipmentStatus.RETURNED_TO_SELLER, 10),
        statusGroup(ShippingShipmentStatus.IN_TRANSIT, 20),
      ])
      .mockResolvedValueOnce([
        cityGroup('Casablanca', ShippingShipmentStatus.DELIVERED, 40),
        cityGroup('Casablanca', ShippingShipmentStatus.IN_TRANSIT, 10),
        cityGroup('Rabat', ShippingShipmentStatus.DELIVERED, 20),
        cityGroup('Rabat', ShippingShipmentStatus.CANCELLED, 5),
      ]);
    findMany
      .mockResolvedValueOnce([
        deliveredRow('2026-08-10T08:00:00Z', '2026-08-12T08:00:00Z'),
        deliveredRow('2026-08-10T08:00:00Z', '2026-08-13T08:00:00Z'),
      ])
      .mockResolvedValueOnce([
        trendRow('2026-08-12T09:00:00Z', [
          event(ShippingShipmentStatus.DELIVERED, '2026-08-13T10:00:00Z'),
        ]),
        trendRow('2026-08-07T09:00:00Z', [
          event(ShippingShipmentStatus.RETURN_PENDING, '2026-08-12T11:00:00Z'),
        ]),
      ]);
    findFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-13T11:30:00Z'),
    });

    const result = await service.getOverview('user-1', { days: 7 });

    expect(result.period).toEqual({
      days: 7,
      from: '2026-08-07T00:00:00.000Z',
      to: '2026-08-13T12:00:00.000Z',
      timezone: 'UTC',
    });
    expect(result.metrics).toEqual({
      totalShipments: 120,
      activeShipments: 20,
      deliveredShipments: 80,
      returnedShipments: 10,
      deliveredRate: 80,
      returnRate: 8.33,
      averageDeliveryDays: 2.5,
    });
    expect(result.statusBreakdown).toContainEqual({
      status: ShippingShipmentStatus.IN_TRANSIT,
      count: 20,
    });
    expect(result.performance).toHaveLength(7);
    expect(result.performance).toContainEqual({
      date: '2026-08-12',
      shipmentCount: 1,
      delivered: 0,
      returned: 1,
    });
    expect(result.performance).toContainEqual({
      date: '2026-08-13',
      shipmentCount: 0,
      delivered: 1,
      returned: 0,
    });
    expect(result.topCities).toEqual([
      { city: 'Casablanca', shipments: 50, delivered: 40, deliveryRate: 80 },
      { city: 'Rabat', shipments: 25, delivered: 20, deliveryRate: 80 },
    ]);
    expect(result.dataUpdatedAt).toBe('2026-08-13T11:30:00.000Z');
  });

  it('returns zero-safe metrics and a complete default seven-day chart', async () => {
    groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    findFirst.mockResolvedValue(null);

    const result = await service.getOverview('user-1', {});

    expect(result.metrics).toEqual({
      totalShipments: 0,
      activeShipments: 0,
      deliveredShipments: 0,
      returnedShipments: 0,
      deliveredRate: 0,
      returnRate: 0,
      averageDeliveryDays: null,
    });
    expect(result.performance).toHaveLength(7);
    expect(result.performance.every((point) => point.shipmentCount === 0)).toBe(
      true,
    );
    expect(result.topCities).toEqual([]);
    expect(result.dataUpdatedAt).toBeNull();
  });
});

function statusGroup(status: ShippingShipmentStatus, count: number) {
  return { normalizedStatus: status, _count: { _all: count } };
}

function cityGroup(
  city: string,
  status: ShippingShipmentStatus,
  count: number,
) {
  return { city, normalizedStatus: status, _count: { _all: count } };
}

function deliveredRow(createdAt: string, deliveredAt: string) {
  return {
    providerCreatedAt: new Date(createdAt),
    createdAt: new Date(createdAt),
    events: [{ eventAt: new Date(deliveredAt) }],
  };
}

function trendRow(
  createdAt: string,
  events: Array<{
    normalizedStatus: ShippingShipmentStatus;
    eventAt: Date;
  }>,
) {
  return {
    providerCreatedAt: new Date(createdAt),
    createdAt: new Date(createdAt),
    events,
  };
}

function event(status: ShippingShipmentStatus, eventAt: string) {
  return { normalizedStatus: status, eventAt: new Date(eventAt) };
}
