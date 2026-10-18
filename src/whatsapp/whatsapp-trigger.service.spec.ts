import { Prisma, ShippingShipmentStatus } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { WhatsAppTriggerService } from './whatsapp-trigger.service';

function order(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    orderName: '#1001',
    externalOrderId: 'ext-1',
    manualCustomerName: null,
    manualCustomerPhone: null,
    customer: { name: 'Customer One', phone: '+212600000002' },
    dispatch: { merchantTracking: 'TRK-1' },
    connection: {
      store: {
        id: 'store-1',
        businessName: 'Test Store',
        country: 'Morocco',
        baseCurrency: 'MAD',
        whatsAppConnection: { status: 'ACTIVE', language: 'fr' },
        whatsAppStatusSettings: [{ enabled: true, delayMinutes: 30 }],
      },
    },
    ...overrides,
  };
}

type MessageData = {
  recipientPhone: string;
  variables: string[];
  sendAfter: Date;
  status: string;
  errorCode: string | null;
};

function setup(orderRow: unknown = order(), env: Record<string, string> = {}) {
  const prisma = {
    ecommerceOrder: { findUnique: jest.fn().mockResolvedValue(orderRow) },
    whatsAppMessage: {
      create: jest
        .fn<Promise<{ id: string }>, [{ data: MessageData }]>()
        .mockResolvedValue({ id: 'm-1' }),
    },
  };
  const config = {
    get: jest.fn((key: string) => ({ WHATSAPP_ENABLED: 'true', ...env })[key]),
  };
  const service = new WhatsAppTriggerService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  const createdData = (): MessageData =>
    prisma.whatsAppMessage.create.mock.calls[0][0].data;
  return { service, prisma, createdData };
}

describe('WhatsAppTriggerService', () => {
  it('queues the message with the configured delay and courier phone first', async () => {
    const { service, createdData } = setup();
    const before = Date.now();

    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.OUT_FOR_DELIVERY,
      statusChangedAt: new Date(),
      recipientPhone: '0600000001',
      recipientName: 'Courier Name',
    });

    expect(result).toBe('QUEUED');
    const data = createdData();
    expect(data).toMatchObject({
      storeId: 'store-1',
      orderId: 'order-1',
      trigger: 'OUT_FOR_DELIVERY',
      templateName: 'zomaal_order_out_for_delivery',
      language: 'fr',
      recipientPhone: '+212600000001',
      variables: ['Courier Name', '#1001', 'Test Store'],
      status: 'SCHEDULED',
      currency: 'MAD',
      idempotencyKey: 'order-1:OUT_FOR_DELIVERY',
    });
    expect(data.sendAfter.getTime()).toBeGreaterThanOrEqual(
      before + 30 * 60_000,
    );
  });

  it('falls back to the customer phone and localized name', async () => {
    const { service, createdData } = setup(
      order({ customer: { name: null, phone: '+212600000002' } }),
    );
    await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.DELIVERED,
      recipientPhone: 'not-a-phone',
    });
    const data = createdData();
    expect(data.recipientPhone).toBe('+212600000002');
    expect(data.variables[0]).toBe('cher client');
  });

  it('records a SKIPPED row when no valid phone exists', async () => {
    const { service, createdData } = setup(order({ customer: null }));
    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.DELIVERED,
    });
    expect(result).toBe('SKIPPED_NO_PHONE');
    expect(createdData()).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'NO_VALID_PHONE',
    });
  });

  it.each([
    ['not a trigger', ShippingShipmentStatus.PENDING, order(), 'NOT_A_TRIGGER'],
    [
      'disconnected',
      ShippingShipmentStatus.DELIVERED,
      order({
        connection: {
          store: {
            ...order().connection.store,
            whatsAppConnection: { status: 'DISCONNECTED', language: 'fr' },
          },
        },
      }),
      'NOT_CONNECTED',
    ],
    [
      'disabled',
      ShippingShipmentStatus.DELIVERED,
      order({
        connection: {
          store: { ...order().connection.store, whatsAppStatusSettings: [] },
        },
      }),
      'DISABLED',
    ],
  ])('does nothing when %s', async (_label, status, row, expected) => {
    const { service, prisma } = setup(row);
    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: status,
    });
    expect(result).toBe(expected);
    expect(prisma.whatsAppMessage.create).not.toHaveBeenCalled();
  });

  it('ignores statuses older than the max age (courier refresh of old parcels)', async () => {
    const { service, prisma } = setup();
    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.DELIVERED,
      statusChangedAt: new Date(Date.now() - 3 * 86_400_000),
    });
    expect(result).toBe('STALE_STATUS');
    expect(prisma.ecommerceOrder.findUnique).not.toHaveBeenCalled();
  });

  it('is idempotent per order and status', async () => {
    const { service, prisma } = setup();
    prisma.whatsAppMessage.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.DELIVERED,
    });
    expect(result).toBe('ALREADY_QUEUED');
  });

  it('does nothing when WhatsApp is disabled on the server', async () => {
    const { service, prisma } = setup(order(), { WHATSAPP_ENABLED: 'false' });
    const result = await service.onShipmentStatus({
      orderId: 'order-1',
      status: ShippingShipmentStatus.DELIVERED,
    });
    expect(result).toBe('NOT_CONNECTED');
    expect(prisma.ecommerceOrder.findUnique).not.toHaveBeenCalled();
  });
});
