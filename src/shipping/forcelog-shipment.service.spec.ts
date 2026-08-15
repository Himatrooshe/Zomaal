import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { ForceLogShipmentService } from './forcelog-shipment.service';

describe('ForceLogShipmentService', () => {
  type ShipmentUpsertArgs = {
    where: {
      userId_providerCode: { userId: string; providerCode: string };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  type EventUpsertArgs = {
    create: Record<string, unknown>;
  };
  const connectionFindUnique = jest.fn();
  const dispatchFindFirst = jest.fn();
  const shipmentUpsert = jest.fn((args: ShipmentUpsertArgs): unknown => {
    void args;
    return undefined;
  });
  const eventUpsert = jest.fn((args: EventUpsertArgs): unknown => {
    void args;
    return undefined;
  });
  const shipmentFindUnique = jest.fn();
  const shipmentFindMany = jest.fn();
  const shipmentCount = jest.fn();
  const tx = {
    forceLogConnection: { findUnique: connectionFindUnique },
    ecommerceOrderDispatch: { findFirst: dispatchFindFirst },
    forceLogShipment: { upsert: shipmentUpsert },
    forceLogTrackingEvent: { upsert: eventUpsert },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
    forceLogShipment: {
      findUnique: shipmentFindUnique,
      findMany: shipmentFindMany,
      count: shipmentCount,
    },
  };
  const client = { getParcel: jest.fn() };
  const connection = {
    getApiKey: jest.fn().mockResolvedValue('secret'),
    updateSyncHealth: jest.fn(),
  };
  const service = new ForceLogShipmentService(
    prisma as never,
    client as never,
    connection as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    connectionFindUnique.mockResolvedValue({ id: 'connection-1' });
    dispatchFindFirst.mockResolvedValue(null);
    shipmentUpsert.mockImplementation(({ create }: ShipmentUpsertArgs) => ({
      id: 'shipment-1',
      createdAt: new Date('2026-08-15T00:00:00Z'),
      updatedAt: new Date('2026-08-15T00:00:00Z'),
      ...create,
    }));
    eventUpsert.mockResolvedValue({ id: 'event-1' });
  });

  it('persists a successfully created ForceLog parcel', async () => {
    await service.persistCreatedParcel(
      'user-1',
      {
        ORDER_NUM: 'ZM-FL-1',
        RECEIVE: 'Sara Test',
        PHONE: '0612345678',
        CITY: 'RBTVIL',
        ADDRESS: 'Rabat',
        COD: 100,
      },
      {
        AUTH: { RESULT: 'SUCCESS' },
        'ADD-PARCEL': {
          RESULT: 'SUCCESS',
          'NEW-PARCEL': {
            TRACKING_NUMBER: 'FL-100',
            ORDER_NUM: 'ZM-FL-1',
            RECEIVER: 'Sara Test',
            PHONE: '0612345678',
            CITY_NAME: 'Rabat',
            ADDRESS: 'Rabat',
            PRICE: '100',
          },
        },
      },
    );

    const shipmentCall = shipmentUpsert.mock.calls[0][0];
    expect(shipmentCall.where).toEqual({
      userId_providerCode: { userId: 'user-1', providerCode: 'FL-100' },
    });
    expect(shipmentCall.create).toMatchObject({
      providerCode: 'FL-100',
      providerStatus: 'NEW_PARCEL',
      normalizedStatus: ShippingShipmentStatus.PENDING,
      reference: 'ZM-FL-1',
      codAmount: new Prisma.Decimal(100),
    });
    expect(eventUpsert.mock.calls[0][0].create).toMatchObject({
      eventType: 'parcel.created',
      providerStatus: 'NEW_PARCEL',
    });
  });

  it('reconciles provider status and delivery fees', async () => {
    await service.reconcileProviderParcel('user-1', 'FL-100', {
      RESULT: 'SUCCESS',
      PARCEL: {
        TRACKING_NUMBER: 'FL-100',
        STATUS: 'Livré',
        SITUATION: 'Payé',
        DELIVERY_FEES: 35,
        PRICE: 100,
      },
    });

    expect(shipmentUpsert.mock.calls[0][0].update).toMatchObject({
      providerStatus: 'Livré',
      normalizedStatus: ShippingShipmentStatus.DELIVERED,
      fee: new Prisma.Decimal(35),
    });
  });

  it('lists shipments with backend pagination', async () => {
    shipmentCount.mockResolvedValue(21);
    shipmentFindMany.mockResolvedValue([]);

    await expect(
      service.list('user-1', { search: 'FL', page: 2, limit: 20 }),
    ).resolves.toEqual({
      data: [],
      pagination: { total: 21, page: 2, limit: 20, totalPages: 2 },
    });
    expect(shipmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 20 }),
    );
  });
});
