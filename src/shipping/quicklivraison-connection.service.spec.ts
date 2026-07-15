import { ConfigService } from '@nestjs/config';
import { QuickLivraisonConnectionService } from './quicklivraison-connection.service';
import { QuickLivraisonClient } from './quicklivraison.client';

describe('QuickLivraisonConnectionService', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  let storedConnection:
    | {
        userId: string;
        encryptedApiKey: string;
        keyType: string;
        connectedAt: Date;
      }
    | undefined;
  let prisma: {
    quickLivraisonConnection: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let client: { checkConnection: jest.Mock };
  let service: QuickLivraisonConnectionService;

  beforeEach(() => {
    storedConnection = undefined;
    prisma = {
      quickLivraisonConnection: {
        upsert: jest.fn(({ create, update }) => {
          storedConnection = storedConnection
            ? { ...storedConnection, ...update }
            : { ...create, connectedAt: new Date('2026-07-15T10:30:00.000Z') };
          return storedConnection;
        }),
        findUnique: jest.fn(({ select }) => {
          if (!storedConnection) return null;
          if (!select) return storedConnection;
          return Object.fromEntries(
            Object.keys(select).map((key) => [
              key,
              storedConnection?.[key as keyof typeof storedConnection],
            ]),
          );
        }),
        deleteMany: jest.fn(() => {
          storedConnection = undefined;
          return { count: 1 };
        }),
      },
    };
    client = {
      checkConnection: jest.fn().mockResolvedValue({ connected: true }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'SHIPPING_CREDENTIAL_ENCRYPTION_KEY'
          ? encryptionKey
          : undefined,
      ),
    };
    service = new QuickLivraisonConnectionService(
      prisma as never,
      config as unknown as ConfigService,
      client as unknown as QuickLivraisonClient,
    );
  });

  it('validates and encrypts a subuser key before storing it', async () => {
    const status = await service.connect('user-1', {
      apiKey: ' sub_test_key ',
    });

    expect(client.checkConnection).toHaveBeenCalledWith('sub_test_key');
    expect(storedConnection?.encryptedApiKey).not.toContain('sub_test_key');
    expect(storedConnection?.keyType).toBe('subuser');
    expect(status).toEqual({
      connected: true,
      provider: 'quicklivraison.ma',
      keyType: 'subuser',
      connectedAt: '2026-07-15T10:30:00.000Z',
      message: 'QuickLivraison account is connected',
    });
    await expect(service.getApiKey('user-1')).resolves.toBe('sub_test_key');
  });

  it('does not store a key rejected by QuickLivraison', async () => {
    client.checkConnection.mockRejectedValue(new Error('invalid key'));

    await expect(
      service.connect('user-1', { apiKey: 'invalid' }),
    ).rejects.toThrow('invalid key');
    expect(prisma.quickLivraisonConnection.upsert).not.toHaveBeenCalled();
  });

  it('returns disconnected status and disconnects idempotently', async () => {
    await expect(service.getStatus('user-1')).resolves.toMatchObject({
      connected: false,
      keyType: null,
    });
    await expect(service.disconnect('user-1')).resolves.toMatchObject({
      connected: false,
      message: 'QuickLivraison account disconnected',
    });
  });
});
