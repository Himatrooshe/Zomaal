import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { PrismaService } from '../prisma/prisma.service';
import type { WhatsAppBalanceService } from './whatsapp-balance.service';
import type { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';

const APP_SECRET = 'test-app-secret';

function sign(body: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;
}

function payload(changes: unknown[]) {
  return Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ id: 'waba-1', changes }],
    }),
  );
}

function setup(messageStatus = 'SENT') {
  const prisma = {
    whatsAppMessage: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'msg-1',
        storeId: 'store-1',
        status: messageStatus,
        rawPayload: null,
      }),
      update: jest
        .fn<Promise<object>, [{ data: Record<string, unknown> }]>()
        .mockResolvedValue({}),
    },
    whatsAppConnection: {
      findMany: jest.fn().mockResolvedValue([{ storeId: 'store-1' }]),
    },
    whatsAppTemplate: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const balance = { refundMessage: jest.fn().mockResolvedValue(true) };
  const connections = { markReauthRequired: jest.fn() };
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          META_APP_SECRET: APP_SECRET,
          META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me',
        })[key],
    ),
  };
  const service = new WhatsAppWebhookService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    balance as unknown as WhatsAppBalanceService,
    connections as unknown as WhatsAppConnectionService,
  );
  return { service, prisma, balance, connections };
}

describe('WhatsAppWebhookService', () => {
  it('answers the subscription handshake only with the right token', () => {
    const { service } = setup();
    expect(service.verifySubscription('subscribe', 'verify-me', '123')).toBe(
      '123',
    );
    expect(() =>
      service.verifySubscription('subscribe', 'wrong', '123'),
    ).toThrow(ForbiddenException);
  });

  it('rejects a missing or wrong signature', async () => {
    const { service } = setup();
    const body = payload([]);
    await expect(service.handle(undefined, body)).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.handle('sha256=deadbeef', body)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('advances a message to DELIVERED', async () => {
    const { service, prisma } = setup('SENT');
    const body = payload([
      {
        field: 'messages',
        value: {
          statuses: [
            { id: 'wamid.1', status: 'delivered', timestamp: '1760000000' },
          ],
        },
      },
    ]);
    await expect(service.handle(sign(body), body)).resolves.toMatchObject({
      statuses: 1,
    });
    expect(prisma.whatsAppMessage.update.mock.calls[0][0].data).toMatchObject({
      status: 'DELIVERED',
      deliveredAt: new Date(1760000000 * 1000),
    });
  });

  it('never moves a READ message back to DELIVERED', async () => {
    const { service, prisma } = setup('READ');
    const body = payload([
      {
        field: 'messages',
        value: { statuses: [{ id: 'wamid.1', status: 'delivered' }] },
      },
    ]);
    await service.handle(sign(body), body);
    expect(
      prisma.whatsAppMessage.update.mock.calls[0][0].data.status,
    ).toBeUndefined();
  });

  it('marks FAILED and refunds the charge', async () => {
    const { service, prisma, balance } = setup('SENT');
    const body = payload([
      {
        field: 'messages',
        value: {
          statuses: [
            {
              id: 'wamid.1',
              status: 'failed',
              errors: [{ code: 131026, title: 'Message undeliverable' }],
            },
          ],
        },
      },
    ]);
    await service.handle(sign(body), body);
    expect(prisma.whatsAppMessage.update.mock.calls[0][0].data).toMatchObject({
      status: 'FAILED',
      errorCode: '131026',
      errorMessage: 'Message undeliverable',
    });
    expect(balance.refundMessage).toHaveBeenCalledWith('store-1', 'msg-1');
  });

  it('ignores a failure reported after delivery', async () => {
    const { service, prisma, balance } = setup('DELIVERED');
    const body = payload([
      {
        field: 'messages',
        value: { statuses: [{ id: 'wamid.1', status: 'failed' }] },
      },
    ]);
    await service.handle(sign(body), body);
    expect(prisma.whatsAppMessage.update).not.toHaveBeenCalled();
    expect(balance.refundMessage).not.toHaveBeenCalled();
  });

  it('applies template approval updates', async () => {
    const { service, prisma } = setup();
    const body = payload([
      {
        field: 'message_template_status_update',
        value: {
          event: 'REJECTED',
          message_template_id: 555,
          message_template_name: 'zomaal_order_delivered',
          message_template_language: 'fr',
          reason: 'INVALID_FORMAT',
        },
      },
    ]);
    await expect(service.handle(sign(body), body)).resolves.toMatchObject({
      templates: 1,
    });
    expect(prisma.whatsAppTemplate.updateMany).toHaveBeenCalledWith({
      where: {
        storeId: { in: ['store-1'] },
        name: 'zomaal_order_delivered',
        language: 'fr',
      },
      data: {
        status: 'REJECTED',
        rejectedReason: 'INVALID_FORMAT',
        metaTemplateId: '555',
      },
    });
  });
});
