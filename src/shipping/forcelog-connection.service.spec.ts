import { ConfigService } from '@nestjs/config';
import { ForceLogClient } from './forcelog.client';
import { ForceLogConnectionService } from './forcelog-connection.service';

describe('ForceLogConnectionService', () => {
  const encryptionKey = Buffer.alloc(32, 9).toString('base64');
  type StoredConnection = {
    userId: string;
    encryptedApiKey: string;
    connectedAt: Date;
  };
  let storedConnection: StoredConnection | undefined;
  let prisma: {
    forceLogConnection: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let client: { checkConnection: jest.Mock };
  let service: ForceLogConnectionService;

  beforeEach(() => {
    storedConnection = undefined;
    prisma = {
      forceLogConnection: {
        upsert: jest.fn(
          ({
            create,
            update,
          }: {
            create: Omit<StoredConnection, 'connectedAt'>;
            update: Pick<StoredConnection, 'encryptedApiKey' | 'connectedAt'>;
          }) => {
            storedConnection = storedConnection
              ? { ...storedConnection, ...update }
              : {
                  ...create,
                  connectedAt: new Date('2026-07-16T10:30:00.000Z'),
                };
            return storedConnection;
          },
        ),
        findUnique: jest.fn(
          ({ select }: { select?: Record<string, boolean> }) => {
            if (!storedConnection) return null;
            if (!select) return storedConnection;
            if (select.encryptedApiKey) {
              return { encryptedApiKey: storedConnection.encryptedApiKey };
            }
            return { connectedAt: storedConnection.connectedAt };
          },
        ),
        deleteMany: jest.fn(() => {
          storedConnection = undefined;
          return { count: 1 };
        }),
      },
    };
    client = { checkConnection: jest.fn().mockResolvedValue([]) };
    const config = {
      get: jest.fn((key: string) =>
        key === 'SHIPPING_CREDENTIAL_ENCRYPTION_KEY'
          ? encryptionKey
          : undefined,
      ),
    };
    service = new ForceLogConnectionService(
      prisma as never,
      config as unknown as ConfigService,
      client as unknown as ForceLogClient,
    );
  });

  it('validates and encrypts the API key before storing it', async () => {
    const status = await service.connect('user-1', {
      apiKey: ' forcelog-test-key ',
    });

    expect(client.checkConnection).toHaveBeenCalledWith('forcelog-test-key');
    expect(storedConnection?.encryptedApiKey).not.toContain(
      'forcelog-test-key',
    );
    expect(status).toEqual({
      connected: true,
      provider: 'forcelog.ma',
      connectedAt: '2026-07-16T10:30:00.000Z',
      message: 'ForceLog account is connected',
    });
    await expect(service.getApiKey('user-1')).resolves.toBe(
      'forcelog-test-key',
    );
  });

  it('does not store a key rejected by ForceLog', async () => {
    client.checkConnection.mockRejectedValue(new Error('invalid key'));

    await expect(
      service.connect('user-1', { apiKey: 'invalid' }),
    ).rejects.toThrow('invalid key');
    expect(prisma.forceLogConnection.upsert).not.toHaveBeenCalled();
  });

  it('returns disconnected status and disconnects idempotently', async () => {
    await expect(service.getStatus('user-1')).resolves.toMatchObject({
      connected: false,
      connectedAt: null,
    });
    await expect(service.disconnect('user-1')).resolves.toMatchObject({
      connected: false,
      message: 'ForceLog account disconnected',
    });
  });
});
