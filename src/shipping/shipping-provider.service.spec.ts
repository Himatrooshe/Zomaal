import { ShippingShipmentStatus } from '@prisma/client';
import { ShippingProvider } from './dto/shipping-provider.dto';
import { ShippingProviderService } from './shipping-provider.service';

describe('ShippingProviderService', () => {
  const connection = () => ({
    getStatus: jest.fn().mockResolvedValue({
      connected: true,
      connectedAt: '2026-08-15T00:00:00.000Z',
      lastSyncedAt: '2026-08-15T01:00:00.000Z',
      message: 'connected',
    }),
  });
  const shipment = (providerFields: Record<string, unknown> = {}) => ({
    list: jest.fn().mockResolvedValue({
      data: [shipmentValue(providerFields)],
      pagination: { total: 1, page: 1, limit: 20, totalPages: 1 },
    }),
    getByProviderCode: jest
      .fn()
      .mockResolvedValue({ ...shipmentValue(providerFields), events: [] }),
    get: jest
      .fn()
      .mockResolvedValue({ ...shipmentValue(providerFields), events: [] }),
    getTimeline: jest.fn().mockResolvedValue(timelineValue(providerFields)),
    timeline: jest.fn().mockResolvedValue(timelineValue(providerFields)),
    sync: jest.fn().mockResolvedValue({
      success: true,
      selected: 1,
      refreshed: 1,
      failed: 0,
      syncedAt: '2026-08-15T02:00:00.000Z',
    }),
  });
  const sync = () => ({
    sync: jest.fn().mockResolvedValue({
      success: true,
      processed: 1,
      imported: 1,
      syncedAt: '2026-08-15T02:00:00.000Z',
    }),
  });
  const overview = () => ({
    getOverview: jest.fn().mockResolvedValue({
      metrics: { totalShipments: 1, averageDeliveryDays: 2 },
      statusBreakdown: [],
      performance: [],
      topCities: [],
      sync: { lastSyncedAt: null, lastSyncError: null },
    }),
  });

  const senditConnection = connection();
  const senditShipments = shipment({ providerReturnStatus: 'NONE' });
  const senditSync = sync();
  const senditOverview = overview();
  const quickConnection = connection();
  const quickShipments = shipment({
    providerSecondaryStatus: 'SECONDARY',
    storeName: 'Store',
  });
  const quickSync = sync();
  const quickOverview = overview();
  const forceConnection = connection();
  const forceShipments = shipment({
    situation: 'At hub',
    productNature: 'Headphones',
    comment: 'Handle carefully',
  });
  const forceOverview = overview();
  const ozoneConnection = connection();
  const ozoneShipments = shipment({
    nature: 'Headphones',
    note: 'Handle carefully',
    deliveredPrice: '35.0000',
  });
  const ozoneOverview = overview();
  const ameexConnection = connection();
  const ameexShipments = shipment({
    providerSubStatus: 'POSTPONED',
    nature: 'Headphones',
    note: 'Handle carefully',
  });
  const ameexOverview = overview();

  const service = new ShippingProviderService(
    senditConnection as never,
    senditShipments as never,
    senditSync as never,
    senditOverview as never,
    quickConnection as never,
    quickShipments as never,
    quickSync as never,
    quickOverview as never,
    forceConnection as never,
    forceShipments as never,
    forceOverview as never,
    ozoneConnection as never,
    ozoneShipments as never,
    ozoneOverview as never,
    ameexConnection as never,
    ameexShipments as never,
    ameexOverview as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each(Object.values(ShippingProvider))(
    'returns the same shipment keys for %s',
    async (provider) => {
      const result = await service.list('user-1', provider, {});

      expect(result.pagination).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
      expect(Object.keys(result.data[0]).sort()).toEqual(
        [
          'id',
          'provider',
          'providerCode',
          'providerStatus',
          'providerSubStatus',
          'normalizedStatus',
          'reference',
          'recipientName',
          'recipientPhone',
          'address',
          'city',
          'cityId',
          'codAmount',
          'fee',
          'currency',
          'productName',
          'note',
          'lastActionAt',
          'providerCreatedAt',
          'providerUpdatedAt',
          'createdAt',
          'updatedAt',
          'providerDetails',
        ].sort(),
      );
      expect(result.data[0].provider).toBe(provider);
    },
  );

  it.each(Object.values(ShippingProvider))(
    'normalizes connection, detail, timeline, sync, and overview for %s',
    async (provider) => {
      const [connectionResult, detail, timeline, syncResult, overviewResult] =
        await Promise.all([
          service.connection('user-1', provider),
          service.detail('user-1', provider, 'TRACK-1'),
          service.timeline('user-1', provider, 'TRACK-1'),
          service.sync('user-1', provider, {}),
          service.overview('user-1', provider, { days: 7 }),
        ]);

      expect(connectionResult).toMatchObject({ provider, connected: true });
      expect(detail).toMatchObject({ provider, providerCode: 'TRACK-1' });
      expect(detail.events).toEqual([]);
      expect(timeline).toMatchObject({ provider, providerCode: 'TRACK-1' });
      expect(syncResult).toEqual(
        expect.objectContaining({ provider, success: true, failed: 0 }),
      );
      expect(overviewResult).toMatchObject({
        provider,
        metrics: { totalShipments: 1, averageDeliveryDays: 2 },
      });
    },
  );
});

function shipmentValue(providerFields: Record<string, unknown>) {
  return {
    id: 'shipment-1',
    providerCode: 'TRACK-1',
    providerStatus: 'IN_PROGRESS',
    normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
    reference: 'ORDER-1',
    recipientName: 'Recipient',
    recipientPhone: '0612345678',
    address: 'Address',
    city: 'Rabat',
    cityId: 1,
    codAmount: '100.0000',
    fee: '35.0000',
    currency: 'MAD',
    lastActionAt: '2026-08-15T01:00:00.000Z',
    providerCreatedAt: '2026-08-14T00:00:00.000Z',
    providerUpdatedAt: '2026-08-15T01:00:00.000Z',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-15T01:00:00.000Z',
    ...providerFields,
  };
}

function timelineValue(providerFields: Record<string, unknown>) {
  return {
    providerCode: 'TRACK-1',
    providerStatus: 'IN_PROGRESS',
    normalizedStatus: ShippingShipmentStatus.IN_TRANSIT,
    lastActionAt: '2026-08-15T01:00:00.000Z',
    events: [],
    ...providerFields,
  };
}
