import { ShippingShipmentStatus } from '@prisma/client';
import { AmeexShipmentService } from './ameex-shipment.service';

describe('AmeexShipmentService', () => {
  type UpsertArgs = {
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  const shipmentUpsert = jest.fn((args: UpsertArgs): unknown => args);
  const eventUpsert = jest.fn();
  const tx = {
    ameexConnection: {
      findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }),
    },
    ameexShipment: { upsert: shipmentUpsert },
    ameexTrackingEvent: { upsert: eventUpsert },
  };
  const prisma = {
    $transaction: jest.fn((callback: (value: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const service = new AmeexShipmentService(
    prisma as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    shipmentUpsert.mockImplementation(({ create }: UpsertArgs) => ({
      id: 'shipment-1',
      createdAt: new Date('2026-08-15T00:00:00Z'),
      updatedAt: new Date('2026-08-15T00:00:00Z'),
      ...create,
    }));
    eventUpsert.mockResolvedValue({ id: 'event-1' });
  });

  it('persists the real lowercase api.data.code creation response', async () => {
    await service.persistCreatedParcel(
      'user-1',
      {
        type: 'SIMPLE',
        orderNumber: 'ZM-AM-TEST-006',
        receiver: 'Ameex Test Recipient',
        phone: '0612345678',
        city: '1',
        address: 'Test address',
        cod: 100,
      },
      {
        login: 'success',
        api: {
          type: 'success',
          msg: 'Colis ajouté avec succès',
          data: {
            id: 9482138,
            code: 'MRK0826B8024YS8312849',
            c_1: 'C-1',
            c_2: 'MRK',
          },
        },
      },
    );

    expect(shipmentUpsert.mock.calls[0][0].create).toMatchObject({
      providerCode: 'MRK0826B8024YS8312849',
      providerStatus: 'NEW',
      normalizedStatus: ShippingShipmentStatus.PENDING,
      reference: 'ZM-AM-TEST-006',
      cityId: 1,
    });
    expect(eventUpsert).toHaveBeenCalledTimes(1);
  });

  describe('manual synchronization', () => {
    it('imports remote pages and mass-tracks active shipments', async () => {
      const stored = new Map<string, Record<string, unknown>>();
      const trackingEventUpsert = jest.fn().mockResolvedValue({});
      const transactionClient = {
        ameexConnection: {
          findUnique: jest.fn().mockResolvedValue({ id: 'connection-1' }),
        },
        ameexShipment: {
          upsert: jest.fn(({ create, update, where }) => {
            const code = where.userId_providerCode.providerCode as string;
            const value = {
              id: `shipment-${code}`,
              ...(stored.get(code) ?? create),
              ...update,
            };
            stored.set(code, value);
            return value;
          }),
        },
        ameexTrackingEvent: { upsert: trackingEventUpsert },
      };
      const prisma = {
        $transaction: jest.fn(
          (callback: (value: typeof transactionClient) => unknown) =>
            callback(transactionClient),
        ),
        ameexShipment: {
          findUnique: jest.fn(({ where }) => {
            const code = where.userId_providerCode.providerCode as string;
            return stored.has(code) ? { id: `shipment-${code}` } : null;
          }),
          findMany: jest
            .fn()
            .mockResolvedValue([
              { providerCode: 'AM-1' },
              { providerCode: 'AM-2' },
            ]),
        },
        ameexTrackingEvent: { upsert: trackingEventUpsert },
      };
      const client = {
        listParcels: jest.fn().mockResolvedValue({
          login: 'success',
          api: {
            type: 'success',
            data: {
              recordsTotal: 2,
              data: [
                {
                  code: 'AM-1',
                  statut: 'IN_PROGRESS',
                  receiver: 'First receiver',
                },
                {
                  code: 'AM-2',
                  statut: 'DISTRIBUTION',
                  receiver: 'Second receiver',
                },
              ],
            },
          },
        }),
        massTracking: jest.fn().mockResolvedValue({
          api: {
            data: {
              'AM-1': {
                HISTORY: [
                  {
                    STATUT: 'IN_PROGRESS',
                    TIME_STR: '2026-08-15 10:00:00',
                  },
                ],
              },
            },
          },
        }),
        getTracking: jest.fn().mockResolvedValue({
          api: {
            data: {
              HISTORY: [
                {
                  STATUT: 'DELIVERED',
                  TIME_STR: '2026-08-15 11:00:00',
                },
              ],
            },
          },
        }),
      };
      const connection = {
        getCredentials: jest
          .fn()
          .mockResolvedValue({ apiId: 'api-id', apiKey: 'api-key' }),
        updateSyncHealth: jest.fn().mockResolvedValue(undefined),
      };
      const syncService = new AmeexShipmentService(
        prisma as never,
        client as never,
        connection as never,
      );

      const result = await syncService.sync('user-1', {});

      expect(client.listParcels).toHaveBeenCalledWith(
        { apiId: 'api-id', apiKey: 'api-key' },
        { start: 0, length: 100 },
      );
      expect(client.massTracking).toHaveBeenCalledWith(
        { apiId: 'api-id', apiKey: 'api-key' },
        { codes: ['AM-1', 'AM-2'] },
      );
      expect(client.getTracking).toHaveBeenCalledWith(
        { apiId: 'api-id', apiKey: 'api-key' },
        'AM-2',
      );
      expect(prisma.ameexShipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            normalizedStatus: {
              notIn: [
                'DELIVERED',
                'CANCELLED',
                'RETURNED_TO_STOCK',
                'RETURNED_TO_SELLER',
              ],
            },
          }),
        }),
      );
      expect(result).toMatchObject({
        success: true,
        imported: 2,
        remoteFound: 2,
        importPages: 1,
        selected: 2,
        refreshed: 2,
        trackingFallbacks: 1,
        failed: 0,
      });
      expect(trackingEventUpsert).toHaveBeenCalled();
    });
  });
});
