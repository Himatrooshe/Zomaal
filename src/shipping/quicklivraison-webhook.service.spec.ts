import { UnauthorizedException } from '@nestjs/common';
import { ShippingShipmentStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { QuickLivraisonShipmentService } from './quicklivraison-shipment.service';

describe('QuickLivraisonShipmentService webhook', () => {
  type UpdateManyArgs = { where: unknown; data: Record<string, unknown> };
  type EventUpsertArgs = {
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  };
  let lastUpdate: UpdateManyArgs | undefined;
  let lastEvent: EventUpsertArgs | undefined;
  const findFirst = jest.fn();
  const updateMany = jest
    .fn<(args: UpdateManyArgs) => Promise<{ count: number }>>()
    .mockImplementation((args: UpdateManyArgs) => {
      lastUpdate = args;
      return Promise.resolve({ count: 1 });
    });
  const eventUpsert = jest
    .fn<(args: EventUpsertArgs) => Promise<Record<string, never>>>()
    .mockImplementation((args: EventUpsertArgs) => {
      lastEvent = args;
      return Promise.resolve({});
    });
  const tx = {
    quickLivraisonShipment: { updateMany },
    quickLivraisonTrackingEvent: { upsert: eventUpsert },
  };
  const prisma = {
    quickLivraisonShipment: { findFirst },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const config = { get: jest.fn().mockReturnValue('webhook-secret') };
  const service = new QuickLivraisonShipmentService(
    prisma as never,
    config as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    lastUpdate = undefined;
    lastEvent = undefined;
    config.get.mockReturnValue('webhook-secret');
    findFirst.mockResolvedValue({ id: 'shipment-1', lastActionAt: null });
  });

  it('verifies and persists a documented status_changed event', async () => {
    const payload = {
      event: 'status_changed',
      timestamp: '2026-05-22T15:00:00+01:00',
      data: {
        tracking_number: 'PARCEL123456',
        status: 'DELIVERED',
        status_second: null,
        new_status_code: 'DELIVERED',
        situation: 'PAID',
        price: 250,
        receiver_name: 'Ahmed',
        receiver_phone: '0612345678',
        receiver_address: '123 Rue Hassan II',
        city: 'Casablanca',
        store_name: 'Ma Boutique',
        comment: 'Livré avec succès',
      },
    };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', 'webhook-secret')
      .update(rawBody)
      .digest('hex')}`;

    await expect(
      service.processStatusWebhook(
        { 'x-webhook-signature': signature },
        payload,
        rawBody,
      ),
    ).resolves.toEqual({
      success: true,
      message: 'QuickLivraison webhook received',
    });
    expect(lastUpdate?.data).toMatchObject({
      providerStatus: 'DELIVERED',
      normalizedStatus: ShippingShipmentStatus.DELIVERED,
      city: 'Casablanca',
    });
    expect(lastEvent?.create).toMatchObject({
      eventType: 'status_changed',
      normalizedStatus: ShippingShipmentStatus.DELIVERED,
      message: 'Livré avec succès',
    });
  });

  it('rejects a forged signature before reading the shipment', async () => {
    const payload = {
      event: 'status_changed',
      timestamp: '2026-05-22T15:00:00+01:00',
      data: { tracking_number: 'PARCEL123456', status: 'DELIVERED' },
    };

    await expect(
      service.processStatusWebhook(
        { 'x-webhook-signature': 'sha256=forged' },
        payload,
        Buffer.from(JSON.stringify(payload)),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
