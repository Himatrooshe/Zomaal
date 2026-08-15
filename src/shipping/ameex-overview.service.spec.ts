import { ShippingShipmentStatus } from '@prisma/client';
import { AmeexOverviewService } from './ameex-overview.service';

describe('AmeexOverviewService', () => {
  const groupBy = jest.fn();
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const connectionFindUnique = jest.fn();
  const service = new AmeexOverviewService({
    ameexShipment: { groupBy, findMany, findFirst },
    ameexConnection: { findUnique: connectionFindUnique },
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-15T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('calculates delivery time from provider creation to first delivery', async () => {
    groupBy
      .mockResolvedValueOnce([
        statusGroup(ShippingShipmentStatus.DELIVERED, 8),
        statusGroup(ShippingShipmentStatus.RETURNED_TO_SELLER, 1),
        statusGroup(ShippingShipmentStatus.IN_TRANSIT, 1),
      ])
      .mockResolvedValueOnce([
        cityGroup('Rabat', ShippingShipmentStatus.DELIVERED, 8),
        cityGroup('Rabat', ShippingShipmentStatus.IN_TRANSIT, 1),
      ]);
    findMany
      .mockResolvedValueOnce([
        {
          providerCreatedAt: new Date('2026-08-12T08:00:00Z'),
          createdAt: new Date('2026-08-12T10:00:00Z'),
          events: [{ eventAt: new Date('2026-08-14T08:00:00Z') }],
        },
      ])
      .mockResolvedValueOnce([]);
    findFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-15T11:00:00Z'),
    });
    connectionFindUnique.mockResolvedValue({
      lastSyncedAt: new Date('2026-08-15T10:00:00Z'),
      lastSyncError: null,
    });

    const result = await service.getOverview('user-1', { days: 7 });

    expect(result.metrics).toEqual({
      totalShipments: 10,
      activeShipments: 1,
      deliveredShipments: 8,
      returnedShipments: 1,
      deliveredRate: 88.89,
      returnRate: 10,
      averageDeliveryDays: 2,
    });
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
