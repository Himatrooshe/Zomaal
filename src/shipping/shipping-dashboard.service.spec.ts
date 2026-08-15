import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { ShippingDashboardService } from './shipping-dashboard.service';

describe('ShippingDashboardService', () => {
  const senditGroupBy = jest.fn();
  const quickGroupBy = jest.fn();
  const forceLogGroupBy = jest.fn();
  const ozoneGroupBy = jest.fn();
  const ameexGroupBy = jest.fn();
  const senditFindFirst = jest.fn();
  const quickFindFirst = jest.fn();
  const forceLogFindFirst = jest.fn();
  const ozoneFindFirst = jest.fn();
  const ameexFindFirst = jest.fn();
  const service = new ShippingDashboardService({
    senditShipment: {
      groupBy: senditGroupBy,
      findFirst: senditFindFirst,
    },
    quickLivraisonShipment: {
      groupBy: quickGroupBy,
      findFirst: quickFindFirst,
    },
    forceLogShipment: {
      groupBy: forceLogGroupBy,
      findFirst: forceLogFindFirst,
    },
    ozoneExpressShipment: {
      groupBy: ozoneGroupBy,
      findFirst: ozoneFindFirst,
    },
    ameexShipment: {
      groupBy: ameexGroupBy,
      findFirst: ameexFindFirst,
    },
  } as never);

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T12:00:00Z'));
    senditFindFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-14T11:00:00Z'),
    });
    quickFindFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-14T11:30:00Z'),
    });
    forceLogFindFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-14T11:45:00Z'),
    });
    ozoneFindFirst.mockResolvedValue({
      updatedAt: new Date('2026-08-14T11:50:00Z'),
    });
    ameexGroupBy.mockResolvedValue([]);
    ameexFindFirst.mockResolvedValue(null);
  });

  afterEach(() => jest.useRealTimers());

  it('combines provider fees and status-specific cost cards', async () => {
    senditGroupBy.mockResolvedValue([
      costGroup(ShippingShipmentStatus.DELIVERED, 10, 10, '350'),
      costGroup(ShippingShipmentStatus.CANCELLED, 2, 2, '40'),
      costGroup(ShippingShipmentStatus.PICKED_UP, 3, 3, '60'),
    ]);
    quickGroupBy.mockResolvedValue([
      costGroup(ShippingShipmentStatus.DELIVERED, 5, 4, '120'),
      costGroup(ShippingShipmentStatus.REFUSED, 2, 1, '25'),
    ]);
    forceLogGroupBy.mockResolvedValue([
      costGroup(ShippingShipmentStatus.DELIVERED, 2, 2, '70'),
    ]);
    ozoneGroupBy.mockResolvedValue([
      costGroup(ShippingShipmentStatus.DELIVERED, 1, 1, '35'),
    ]);

    const result = await service.getHome('user-1', { days: 1 });

    expect(result).toMatchObject({
      period: {
        days: 1,
        from: '2026-08-14T00:00:00.000Z',
        to: '2026-08-14T12:00:00.000Z',
        timezone: 'UTC',
      },
      currency: 'MAD',
      totalShippingCost: '700.0000',
      averageShippingCostPerPricedShipment: '30.4348',
      totalShipments: 25,
      pricedShipments: 23,
      costCoveragePercentage: 92,
      delivery: { cost: '575.0000', shipments: 18, pricedShipments: 17 },
      cancelled: { cost: '40.0000', shipments: 2, pricedShipments: 2 },
      refused: { cost: '25.0000', shipments: 2, pricedShipments: 1 },
      pickup: { cost: '60.0000', shipments: 3, pricedShipments: 3 },
      dataUpdatedAt: '2026-08-14T11:50:00.000Z',
    });
    expect(result.providers).toEqual([
      {
        provider: 'sendit',
        cost: '450.0000',
        shipments: 15,
        pricedShipments: 15,
      },
      {
        provider: 'quicklivraison',
        cost: '145.0000',
        shipments: 7,
        pricedShipments: 5,
      },
      {
        provider: 'forcelog',
        cost: '70.0000',
        shipments: 2,
        pricedShipments: 2,
      },
      {
        provider: 'ozoneexpress',
        cost: '35.0000',
        shipments: 1,
        pricedShipments: 1,
      },
      {
        provider: 'ameex',
        cost: '0.0000',
        shipments: 0,
        pricedShipments: 0,
      },
    ]);
  });

  it('returns zero-safe metrics when no shipments exist', async () => {
    senditGroupBy.mockResolvedValue([]);
    quickGroupBy.mockResolvedValue([]);
    forceLogGroupBy.mockResolvedValue([]);
    ozoneGroupBy.mockResolvedValue([]);
    ameexGroupBy.mockResolvedValue([]);
    senditFindFirst.mockResolvedValue(null);
    quickFindFirst.mockResolvedValue(null);
    forceLogFindFirst.mockResolvedValue(null);
    ozoneFindFirst.mockResolvedValue(null);
    ameexFindFirst.mockResolvedValue(null);

    const result = await service.getHome('user-1', {});

    expect(result).toMatchObject({
      totalShippingCost: '0.0000',
      averageShippingCostPerPricedShipment: null,
      totalShipments: 0,
      pricedShipments: 0,
      costCoveragePercentage: 0,
      dataUpdatedAt: null,
    });
  });
});

function costGroup(
  normalizedStatus: ShippingShipmentStatus,
  shipments: number,
  pricedShipments: number,
  fee: string,
) {
  return {
    normalizedStatus,
    _count: { _all: shipments, fee: pricedShipments },
    _sum: { fee: new Prisma.Decimal(fee) },
  };
}
