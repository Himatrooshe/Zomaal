import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { OzoneExpressShipmentService } from './ozoneexpress-shipment.service';

describe('OzoneExpressShipmentService', () => {
  type ShipmentUpsertArgs = {
    where: {
      userId_providerCode: { userId: string; providerCode: string };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  type EventUpsertArgs = { create: Record<string, unknown> };

  const connectionFindUnique = jest.fn();
  const dispatchFindFirst = jest.fn();
  const shipmentFindUniqueTx = jest.fn();
  const shipmentUpsert = jest.fn((args: ShipmentUpsertArgs): unknown => args);
  const eventUpsert = jest.fn((args: EventUpsertArgs): unknown => args);
  const shipmentFindUnique = jest.fn();
  const shipmentFindMany = jest.fn();
  const shipmentCount = jest.fn();
  const tx = {
    ozoneExpressConnection: { findUnique: connectionFindUnique },
    ecommerceOrderDispatch: { findFirst: dispatchFindFirst },
    ozoneExpressShipment: {
      findUnique: shipmentFindUniqueTx,
      upsert: shipmentUpsert,
    },
    ozoneExpressTrackingEvent: { upsert: eventUpsert },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    ozoneExpressShipment: {
      findUnique: shipmentFindUnique,
      findMany: shipmentFindMany,
      count: shipmentCount,
    },
  };
  const client = { getParcelInfo: jest.fn(), track: jest.fn() };
  const connection = {
    getCredentials: jest.fn(),
    updateSyncHealth: jest.fn(),
  };
  const service = new OzoneExpressShipmentService(
    prisma as never,
    client as never,
    connection as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    connectionFindUnique.mockResolvedValue({ id: 'connection-1' });
    dispatchFindFirst.mockResolvedValue(null);
    shipmentFindUniqueTx.mockResolvedValue(null);
    shipmentUpsert.mockImplementation(({ create }: ShipmentUpsertArgs) => ({
      id: 'shipment-1',
      createdAt: new Date('2026-08-15T00:00:00Z'),
      updatedAt: new Date('2026-08-15T00:00:00Z'),
      ...create,
    }));
    eventUpsert.mockResolvedValue({ id: 'event-1' });
  });

  it('persists the live ADD-PARCEL contract and all quoted outcome prices', async () => {
    await service.persistCreatedParcel(
      'user-1',
      {
        trackingNumber: 'ZM-OZ-TEST-002',
        receiver: 'OzoneExpress Test',
        phone: '0777296081',
        city: '1984',
        address: 'Test address, Rabat',
        price: 100,
        note: 'Test parcel - do not dispatch',
      },
      addParcelResponse(),
    );

    const call = shipmentUpsert.mock.calls[0][0];
    expect(call.where).toEqual({
      userId_providerCode: {
        userId: 'user-1',
        providerCode: 'ZM-OZ-TEST-002',
      },
    });
    expect(call.create).toMatchObject({
      providerCode: 'ZM-OZ-TEST-002',
      providerStatus: 'Nouveau Colis',
      normalizedStatus: ShippingShipmentStatus.PENDING,
      reference: 'ZM-OZ-TEST-002',
      cityId: 1984,
      codAmount: new Prisma.Decimal(100),
      deliveredPrice: new Prisma.Decimal(35),
      returnedPrice: new Prisma.Decimal(0),
      refusedPrice: new Prisma.Decimal(10),
      fee: null,
    });
    expect(eventUpsert.mock.calls[0][0].create).toMatchObject({
      eventType: 'parcel.created',
      providerStatus: 'Nouveau Colis',
      normalizedStatus: ShippingShipmentStatus.PENDING,
    });
  });

  it('persists real tracking history timestamps and normalized status', async () => {
    shipmentFindUniqueTx.mockResolvedValue({
      deliveredPrice: new Prisma.Decimal(35),
      returnedPrice: new Prisma.Decimal(0),
      refusedPrice: new Prisma.Decimal(10),
    });

    await service.reconcileTracking('user-1', {
      CHECK_API: { RESULT: 'SUCCESS' },
      TRACKING: {
        'TRACKING-NUMBER': 'ZM-OZ-TEST-002',
        RESULT: 'SUCCESS',
        HISTORY: {
          1: {
            STATUT: 'Nouveau Colis',
            TIME: '1786745438',
            TIME_STR: '2026-08-14 23:10',
            COMMENT: '',
          },
        },
        LAST_TRACKING: {
          STATUT: 'Livré',
          TIME_STR: '2026-08-15 13:30:45',
          COMMENT: 'Delivered',
        },
      },
    });

    expect(shipmentUpsert.mock.calls[0][0].update).toMatchObject({
      providerStatus: 'Livré',
      normalizedStatus: ShippingShipmentStatus.DELIVERED,
      fee: new Prisma.Decimal(35),
      lastActionAt: new Date('2026-08-15T13:30:45.000Z'),
    });
    expect(eventUpsert.mock.calls[0][0].create).toMatchObject({
      eventType: 'parcel.status',
      providerStatus: 'Nouveau Colis',
      normalizedStatus: ShippingShipmentStatus.PENDING,
      eventAt: new Date(1786745438 * 1000),
    });
    expect(eventUpsert.mock.calls[1][0].create).toMatchObject({
      providerStatus: 'Livré',
      normalizedStatus: ShippingShipmentStatus.DELIVERED,
      eventAt: new Date('2026-08-15T13:30:45.000Z'),
    });
  });

  it('lists shipments with backend pagination', async () => {
    shipmentCount.mockResolvedValue(21);
    shipmentFindMany.mockResolvedValue([]);

    await expect(
      service.list('user-1', { search: 'ZM-OZ', page: 2, limit: 20 }),
    ).resolves.toEqual({
      data: [],
      pagination: { total: 21, page: 2, limit: 20, totalPages: 2 },
    });
    expect(shipmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
});

function addParcelResponse() {
  return {
    'ADD-PARCEL': {
      CUSTOMER: { RESULT: 'SUCCESS', MESSAGE: 'Valid Customer' },
      RESULT: 'SUCCESS',
      MESSAGE: 'New Parcel Added',
      'NEW-PARCEL': {
        'TRACKING-NUMBER': 'ZM-OZ-TEST-002',
        RECEIVER: 'OzoneExpress Test',
        PHONE: '0777296081',
        CITY_ID: 1984,
        ADDRESS: 'Test address, Rabat',
        PRICE: 100,
        NOTE: 'Test parcel - do not dispatch',
        'DELIVERED-PRICE': 35,
        'RETURNED-PRICE': 0,
        'REFUSED-PRICE': 10,
      },
    },
  };
}
