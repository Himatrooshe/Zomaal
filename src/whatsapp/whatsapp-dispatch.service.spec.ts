import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import {
  MetaGraphError,
  type MetaWhatsAppApiService,
} from './meta-whatsapp-api.service';
import type { WhatsAppBalanceService } from './whatsapp-balance.service';
import type { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppDispatchService } from './whatsapp-dispatch.service';
import type { WhatsAppTokenEncryptionService } from './whatsapp-token-encryption.service';

const D = (v: number) => new Prisma.Decimal(v);

function message(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    storeId: 'store-1',
    orderId: 'order-1',
    trigger: 'OUT_FOR_DELIVERY',
    templateName: 'zomaal_order_out_for_delivery',
    language: 'fr',
    recipientPhone: '+212600000001',
    variables: ['Customer', '#1001', 'Store'],
    status: 'SENDING',
    attempts: 0,
    currency: 'MAD',
    ...overrides,
  };
}

function setup(
  opts: {
    message?: Record<string, unknown>;
    shipmentStatus?: string;
    templateStatus?: string;
    enabled?: boolean;
    connectionStatus?: string;
    price?: Prisma.Decimal | null;
    debitOk?: boolean;
    send?: jest.Mock;
  } = {},
) {
  const updates: Array<Record<string, unknown>> = [];
  const prisma = {
    whatsAppMessage: {
      findUnique: jest.fn().mockResolvedValue(message(opts.message)),
      update: jest.fn(({ data }) => {
        updates.push(data);
        return Promise.resolve({});
      }),
      updateMany: jest.fn(({ data }) => {
        updates.push(data);
        return Promise.resolve({ count: 1 });
      }),
    },
    whatsAppConnection: {
      findUnique: jest.fn().mockResolvedValue({
        storeId: 'store-1',
        wabaId: 'waba-1',
        phoneNumberId: 'phone-1',
        status: opts.connectionStatus ?? 'ACTIVE',
        encryptedAccessToken: 'v1:enc',
      }),
    },
    whatsAppStatusSetting: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ enabled: opts.enabled ?? true }),
    },
    whatsAppTemplate: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ status: opts.templateStatus ?? 'APPROVED' }),
    },
    ecommerceOrderDispatch: {
      findUnique: jest.fn().mockResolvedValue({
        senditShipment: {
          normalizedStatus: opts.shipmentStatus ?? 'OUT_FOR_DELIVERY',
        },
        quickLivraisonShipment: null,
        forceLogShipment: null,
        ozoneExpressShipment: null,
      }),
    },
  };
  const balance = {
    getPrice: jest
      .fn()
      .mockResolvedValue(opts.price === undefined ? D(0.5) : opts.price),
    debitForMessage: jest
      .fn()
      .mockResolvedValue(
        opts.debitOk === false
          ? { ok: false, balance: D(0.2) }
          : { ok: true, balanceAfter: D(9.5) },
      ),
    refundMessage: jest.fn().mockResolvedValue(true),
    checkLowBalance: jest.fn().mockResolvedValue(undefined),
  };
  const meta = {
    sendTemplate:
      opts.send ??
      jest.fn().mockResolvedValue({ messageId: 'wamid.1', raw: { ok: 1 } }),
  };
  const connections = {
    markReauthRequired: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WhatsAppDispatchService(
    prisma as unknown as PrismaService,
    { get: jest.fn() } as unknown as ConfigService,
    meta as unknown as MetaWhatsAppApiService,
    {
      decrypt: jest.fn().mockReturnValue('token'),
    } as unknown as WhatsAppTokenEncryptionService,
    balance as unknown as WhatsAppBalanceService,
    connections as unknown as WhatsAppConnectionService,
  );
  return { service, updates, balance, meta, connections };
}

describe('WhatsAppDispatchService.processOne', () => {
  it('charges, sends and marks SENT', async () => {
    const { service, updates, balance, meta } = setup();
    await expect(service.processOne('msg-1')).resolves.toBe('sent');
    expect(balance.debitForMessage).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 1, currency: 'MAD' }),
    );
    expect(meta.sendTemplate).toHaveBeenCalledWith('token', 'phone-1', {
      to: '+212600000001',
      templateName: 'zomaal_order_out_for_delivery',
      language: 'fr',
      bodyParameters: ['Customer', '#1001', 'Store'],
    });
    expect(updates.at(-1)).toMatchObject({
      status: 'SENT',
      providerMessageId: 'wamid.1',
    });
    expect(balance.refundMessage).not.toHaveBeenCalled();
  });

  it('skips without charging when the parcel moved on', async () => {
    const { service, updates, balance } = setup({
      shipmentStatus: 'DELIVERED',
    });
    await expect(service.processOne('msg-1')).resolves.toBe('skipped');
    expect(updates.at(-1)).toMatchObject({
      status: 'SKIPPED',
      errorCode: 'STATUS_CHANGED',
    });
    expect(balance.debitForMessage).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false }, 'SKIPPED', 'AUTOMATION_DISABLED'],
    [{ connectionStatus: 'DISCONNECTED' }, 'SKIPPED', 'NOT_CONNECTED'],
    [{ templateStatus: 'PENDING' }, 'FAILED', 'TEMPLATE_NOT_APPROVED'],
    [{ price: null }, 'FAILED', 'PRICING_NOT_SET'],
    [{ debitOk: false }, 'FAILED', 'INSUFFICIENT_BALANCE'],
  ])('%p -> %s %s', async (opts, status, code) => {
    const { service, updates, meta } = setup(opts);
    await service.processOne('msg-1');
    expect(updates.at(-1)).toMatchObject({ status, errorCode: code });
    expect(meta.sendTemplate).not.toHaveBeenCalled();
  });

  it('refunds and reschedules on a transient Meta error', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new MetaGraphError('Rate limited', 400, 130429, null));
    const { service, updates, balance } = setup({ send });
    await expect(service.processOne('msg-1')).resolves.toBe('retried');
    expect(balance.refundMessage).toHaveBeenCalledWith('store-1', 'msg-1');
    expect(updates.at(-1)).toMatchObject({
      status: 'SCHEDULED',
      errorCode: '130429',
    });
  });

  it('fails for good after the last attempt', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new MetaGraphError('Unavailable', 503, null, null));
    const { service, updates } = setup({ send, message: { attempts: 2 } });
    await expect(service.processOne('msg-1')).resolves.toBe('failed');
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      errorCode: 'HTTP_503',
    });
  });

  it('refunds and flags reconnect on an auth error', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new MetaGraphError('Token expired', 401, 190, null));
    const { service, updates, balance, connections } = setup({ send });
    await expect(service.processOne('msg-1')).resolves.toBe('failed');
    expect(balance.refundMessage).toHaveBeenCalled();
    expect(connections.markReauthRequired).toHaveBeenCalledWith(
      'store-1',
      expect.any(MetaGraphError),
    );
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      errorCode: 'NOT_AUTHORIZED',
    });
  });

  it('refunds and fails on a permanent Meta error', async () => {
    const send = jest
      .fn()
      .mockRejectedValue(
        new MetaGraphError('Undeliverable', 400, 131026, null),
      );
    const { service, updates, balance } = setup({ send });
    await expect(service.processOne('msg-1')).resolves.toBe('failed');
    expect(balance.refundMessage).toHaveBeenCalled();
    expect(updates.at(-1)).toMatchObject({
      status: 'FAILED',
      errorCode: '131026',
    });
  });

  it('ignores rows that are no longer SENDING', async () => {
    const { service, balance } = setup({ message: { status: 'SENT' } });
    await expect(service.processOne('msg-1')).resolves.toBe('skipped');
    expect(balance.getPrice).not.toHaveBeenCalled();
  });
});
