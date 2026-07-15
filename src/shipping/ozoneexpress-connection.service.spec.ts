import { ConfigService } from '@nestjs/config';
import { OzoneExpressClient } from './ozoneexpress.client';
import { OzoneExpressConnectionService } from './ozoneexpress-connection.service';

describe('OzoneExpressConnectionService', () => {
  const encryptionKey = Buffer.alloc(32, 11).toString('base64');
  type StoredConnection = {
    userId: string;
    encryptedCustomerId: string;
    encryptedApiKey: string;
    connectedAt: Date;
  };
  let storedConnection: StoredConnection | undefined;
  let prisma: {
    ozoneExpressConnection: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let client: { checkConnection: jest.Mock };
  let service: OzoneExpressConnectionService;

  beforeEach(() => {
    storedConnection = undefined;
    prisma = {
      ozoneExpressConnection: {
        upsert: jest.fn(
          ({
            create,
            update,
          }: {
            create: Omit<StoredConnection, 'connectedAt'>;
            update: Pick<
              StoredConnection,
              'encryptedCustomerId' | 'encryptedApiKey' | 'connectedAt'
            >;
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
              return {
                encryptedCustomerId: storedConnection.encryptedCustomerId,
                encryptedApiKey: storedConnection.encryptedApiKey,
              };
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
    client = {
      checkConnection: jest.fn().mockResolvedValue({ authenticated: true }),
    };
    const config = {
      get: jest.fn((key: string) =>
        key === 'SHIPPING_CREDENTIAL_ENCRYPTION_KEY'
          ? encryptionKey
          : undefined,
      ),
    };
    service = new OzoneExpressConnectionService(
      prisma as never,
      config as unknown as ConfigService,
      client as unknown as OzoneExpressClient,
    );
  });

  it('validates and encrypts both credentials before storing them', async () => {
    const status = await service.connect('user-1', {
      customerId: ' 12345 ',
      apiKey: ' ozone-test-key ',
    });

    expect(client.checkConnection).toHaveBeenCalledWith({
      customerId: '12345',
      apiKey: 'ozone-test-key',
    });
    expect(storedConnection?.encryptedCustomerId).not.toContain('12345');
    expect(storedConnection?.encryptedApiKey).not.toContain('ozone-test-key');
    expect(status).toEqual({
      connected: true,
      provider: 'ozoneexpress.ma',
      connectedAt: '2026-07-16T10:30:00.000Z',
      message: 'OzoneExpress account is connected',
    });
    await expect(service.getCredentials('user-1')).resolves.toEqual({
      customerId: '12345',
      apiKey: 'ozone-test-key',
    });
  });

  it('does not store credentials rejected by OzoneExpress', async () => {
    client.checkConnection.mockRejectedValue(new Error('invalid credentials'));

    await expect(
      service.connect('user-1', { customerId: '12345', apiKey: 'invalid' }),
    ).rejects.toThrow('invalid credentials');
    expect(prisma.ozoneExpressConnection.upsert).not.toHaveBeenCalled();
  });

  it('returns disconnected status and disconnects idempotently', async () => {
    await expect(service.getStatus('user-1')).resolves.toMatchObject({
      connected: false,
      connectedAt: null,
    });
    await expect(service.disconnect('user-1')).resolves.toMatchObject({
      connected: false,
      message: 'OzoneExpress account disconnected',
    });
  });
});
