import { ShippingShipmentStatus } from '@prisma/client';
import { QuickLivraisonOverviewService } from './quicklivraison-overview.service';

describe('QuickLivraisonOverviewService', () => {
  const groupBy = jest.fn();
  const findMany = jest.fn();
  const findFirst = jest.fn();
  const connectionFindUnique = jest.fn();
  const service = new QuickLivraisonOverviewService({
    quickLivraisonShipment: { groupBy, findMany, findFirst },
    quickLivraisonConnection: { findUnique: connectionFindUnique },
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-13T12:00:00Z'));
  });

  afterEach(() => jest.useRealTimers());

  it('returns shipment KPIs and synchronization health', async () => {
    groupBy
      .mockResolvedValueOnce([
        statusGroup(ShippingShipmentStatus.DELIVERED, 80),
        statusGroup(ShippingShipmentStatus.RETURNED_TO_SELLER, 10),
        statusGroup(ShippingShipmentStatus.IN_TRANSIT, 10),
      ])
      .mockResolvedValueOnce([
        cityGroup('Casablanca', ShippingShipmentStatus.DELIVERED, 40),
        cityGroup('Casablanca', ShippingShipmentStatus.IN_TRANSIT, 10),
      ]);
    findMany
      .mockResolvedValueOnce([
        {
          providerCreatedAt: new Date('2026-08-10T08:00:00Z'),
          createdAt: new Date('2026-08-10T08:00:00Z'),
          events: [{ eventAt: new Date('2026-08-12T08:00:00Z') }],
        },
      ])
      .mockResolvedValueOnce([]);
    findFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-13T11:00:00Z'),
    });
    connectionFindUnique.mockResolvedValue({
      lastSyncedAt: new Date('2026-08-13T10:00:00Z'),
      lastSyncError: null,
    });

    const result = await service.getOverview('user-1', { days: 7 });

    expect(result.metrics).toEqual({
      totalShipments: 100,
      activeShipments: 10,
      deliveredShipments: 80,
      returnedShipments: 10,
      deliveredRate: 88.89,
      returnRate: 10,
      averageDeliveryDays: 2,
    });
    expect(result.topCities).toEqual([
      {
        city: 'Casablanca',
        shipments: 50,
        delivered: 40,
        deliveryRate: 80,
      },
    ]);
    expect(result.sync).toEqual({
      lastSyncedAt: '2026-08-13T10:00:00.000Z',
      lastSyncError: null,
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
