import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SenditClient } from './sendit.client';
import { SenditConnectionService } from './sendit-connection.service';

describe('SenditConnectionService', () => {
  const encryptionKey = Buffer.alloc(32, 7).toString('base64');
  const connectedAt = new Date('2026-09-30T10:30:00.000Z');
  type StoredConnection = {
    userId: string;
    encryptedPublicKey: string;
    encryptedSecretKey: string;
    accountName: string | null;
    connectedAt: Date;
  };
  let stored: StoredConnection | undefined;
  let prisma: {
    senditConnection: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let client: {
    authenticate: jest.Mock;
    cacheLogin: jest.Mock;
    clearUserToken: jest.Mock;
  };
  let service: SenditConnectionService;

  beforeEach(() => {
    stored = undefined;
    prisma = {
      senditConnection: {
        upsert: jest.fn(
          ({ create }: { create: Omit<StoredConnection, 'connectedAt'> }) => {
            stored = { ...create, connectedAt };
            return stored;
          },
        ),
        findUnique: jest.fn(({ select } = {}) => {
          if (!stored) return null;
          if (!select) return stored;
          return {
            accountName: stored.accountName,
            connectedAt: stored.connectedAt,
          };
        }),
        deleteMany: jest.fn(() => {
          stored = undefined;
          return { count: 1 };
        }),
      },
    };
    client = {
      authenticate: jest.fn().mockResolvedValue({
        success: true,
        message: 'Authenticated',
        data: { token: 'token', name: 'Store' },
      }),
      cacheLogin: jest.fn(),
      clearUserToken: jest.fn(),
    };
    service = new SenditConnectionService(
      prisma as never,
      { get: jest.fn(() => encryptionKey) } as unknown as ConfigService,
      client as unknown as SenditClient,
    );
  });

  it('trims, validates, and encrypts a matched credential pair', async () => {
    await expect(
      service.connect('user-1', {
        public_key: ' public-key ',
        secret_key: ' secret-key ',
      }),
    ).resolves.toEqual({
      connected: true,
      companyCode: 'sendit',
      provider: 'sendit.ma',
      accountName: 'Store',
      connectedAt: connectedAt.toISOString(),
      message: 'Sendit account is connected',
    });

    expect(client.authenticate).toHaveBeenCalledWith({
      publicKey: 'public-key',
      secretKey: 'secret-key',
    });
    expect(stored?.encryptedPublicKey).not.toContain('public-key');
    expect(stored?.encryptedSecretKey).not.toContain('secret-key');
    await expect(service.getCredentials('user-1')).resolves.toEqual({
      publicKey: 'public-key',
      secretKey: 'secret-key',
    });
  });

  it('rejects blank normalized credentials before contacting Sendit', async () => {
    await expect(
      service.connect('user-1', { public_key: ' ', secret_key: 'secret' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.authenticate).not.toHaveBeenCalled();
    expect(prisma.senditConnection.upsert).not.toHaveBeenCalled();
  });

  it('does not store credentials rejected by Sendit', async () => {
    client.authenticate.mockRejectedValue(new Error('rejected'));
    await expect(
      service.connect('user-1', {
        public_key: 'public',
        secret_key: 'secret',
      }),
    ).rejects.toThrow('rejected');
    expect(prisma.senditConnection.upsert).not.toHaveBeenCalled();
  });
});
