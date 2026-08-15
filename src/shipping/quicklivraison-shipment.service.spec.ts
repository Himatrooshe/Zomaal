import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';

describe('QuickLivraisonShipmentService', () => {
  type ShipmentUpsertArgs = {
    where: {
      userId_providerCode: { userId: string; providerCode: string };
    };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  type EventUpsertArgs = {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };

  const connectionFindUnique = jest.fn();
  const dispatchFindMany = jest.fn();
  const shipmentUpsert = jest
    .fn<(args: ShipmentUpsertArgs) => Promise<{ id: string }>>()
    .mockResolvedValue({ id: 'shipment-1' });
  const eventUpsert = jest
    .fn<(args: EventUpsertArgs) => Promise<Record<string, never>>>()
    .mockResolvedValue({});
  const shipmentFindUnique = jest.fn();
  const tx = {
    quickLivraisonConnection: { findUnique: connectionFindUnique },
    ecommerceOrderDispatch: { findMany: dispatchFindMany },
    quickLivraisonShipment: { upsert: shipmentUpsert },
    quickLivraisonTrackingEvent: { upsert: eventUpsert },
  };
  const prisma = {
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
    quickLivraisonShipment: { findUnique: shipmentFindUnique },
  };
  const service = new QuickLivraisonShipmentService(
    prisma as never,
    {
      get: jest.fn(),
    } as never,
  );
  const request = {
    district_id: 123,
    name: 'Sara El Amrani',
    amount: 250,
    phone: '0612345678',
    address: '123 Rue Al Massira',
    code: 'ORDER-1001',
    store_name: 'Zomaal Store',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    connectionFindUnique.mockResolvedValue({ id: 'connection-1' });
    dispatchFindMany.mockResolvedValue([
      { id: 'dispatch-1', merchantTracking: 'ORDER-1001' },
    ]);
  });

  it('stores a created parcel and links its ecommerce dispatch', async () => {
    await service.persistCreatedDelivery('user-1', request, {
      success: 'Colis ajouté avec succès.',
      tracking_number: 'PARCEL_12345678',
    });

    expect(shipmentUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_providerCode: {
            userId: 'user-1',
            providerCode: 'PARCEL_12345678',
          },
        },
        create: expectedCreate(request, 'PARCEL_12345678', 'dispatch-1'),
      }),
    );
    expect(eventUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          shipmentId_providerEventKey: {
            shipmentId: 'shipment-1',
            providerEventKey: 'created:NEW_PARCEL',
          },
        },
      }),
    );
  });

  it('maps documented index-based bulk results to their requests', async () => {
    const secondRequest = {
      ...request,
      code: 'ORDER-1002',
      name: 'Youssef Alaoui',
    };
    dispatchFindMany.mockResolvedValue([]);

    await service.persistBulkCreatedDeliveries(
      'user-1',
      [request, secondRequest],
      {
        success: true,
        parcels: [
          {
            index: 1,
            tracking_number: 'PARCEL_87654321',
            status: 'success',
          },
          {
            index: 0,
            tracking_number: 'PARCEL_12345678',
            status: 'success',
          },
        ],
      },
    );

    expect(shipmentUpsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expectedCreate(secondRequest, 'PARCEL_87654321'),
      }),
    );
    expect(shipmentUpsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expectedCreate(request, 'PARCEL_12345678'),
      }),
    );
  });

  it('rejects a successful provider response without a tracking number', async () => {
    await expect(
      service.persistCreatedDelivery('user-1', request, { success: true }),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not expose a shipment belonging to another user', async () => {
    shipmentFindUnique.mockResolvedValue(null);

    await expect(
      service.getByProviderCode('user-1', 'PARCEL_UNKNOWN'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shipmentFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_providerCode: {
            userId: 'user-1',
            providerCode: 'PARCEL_UNKNOWN',
          },
        },
      }),
    );
  });
});

function expectedCreate(
  request: {
    district_id: number;
    name: string;
    amount: number;
    phone: string;
    address: string;
    code: string;
    store_name: string;
  },
  providerCode: string,
  dispatchId?: string,
) {
  return {
    userId: 'user-1',
    providerCode,
    connectionId: 'connection-1',
    ...(dispatchId ? { dispatchId } : {}),
    providerStatus: 'NEW_PARCEL',
    providerSecondaryStatus: null,
    situation: null,
    normalizedStatus: ShippingShipmentStatus.PENDING,
    reference: request.code,
    recipientName: request.name,
    recipientPhone: request.phone,
    address: request.address,
    destinationDistrictId: request.district_id,
    codAmount: new Prisma.Decimal(request.amount),
    storeName: request.store_name,
  };
}
