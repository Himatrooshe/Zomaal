import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmeexClient } from './ameex.client';
import { AmeexConnectionService } from './ameex-connection.service';

describe('AmeexConnectionService', () => {
  const encryptionKey = Buffer.alloc(32, 8).toString('base64');
  const connectedAt = new Date('2026-09-30T11:30:00.000Z');
  type StoredConnection = {
    userId: string;
    encryptedApiId: string;
    encryptedApiKey: string;
    connectedAt: Date;
    lastSyncedAt: Date | null;
    lastSyncError: string | null;
  };
  let stored: StoredConnection | undefined;
  let prisma: {
    ameexConnection: {
      upsert: jest.Mock;
      findUnique: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let client: { checkConnection: jest.Mock };
  let service: AmeexConnectionService;

  beforeEach(() => {
    stored = undefined;
    prisma = {
      ameexConnection: {
        upsert: jest.fn(
          ({
            create,
          }: {
            create: Omit<
              StoredConnection,
              'connectedAt' | 'lastSyncedAt' | 'lastSyncError'
            >;
          }) => {
            stored = {
              ...create,
              connectedAt,
              lastSyncedAt: null,
              lastSyncError: null,
            };
            return stored;
          },
        ),
        findUnique: jest.fn(
          ({ select }: { select?: Record<string, boolean> } = {}) => {
            if (!stored) return null;
            if (!select) return stored;
            if (select.encryptedApiId || select.encryptedApiKey) {
              return {
                encryptedApiId: stored.encryptedApiId,
                encryptedApiKey: stored.encryptedApiKey,
              };
            }
            return {
              connectedAt: stored.connectedAt,
              lastSyncedAt: stored.lastSyncedAt,
              lastSyncError: stored.lastSyncError,
            };
          },
        ),
        deleteMany: jest.fn(() => {
          stored = undefined;
          return { count: 1 };
        }),
        updateMany: jest.fn(),
      },
    };
    client = { checkConnection: jest.fn().mockResolvedValue([]) };
    service = new AmeexConnectionService(
      prisma as never,
      { get: jest.fn(() => encryptionKey) } as unknown as ConfigService,
      client as unknown as AmeexClient,
    );
  });

  it('trims, validates, and encrypts Ameex credentials', async () => {
    await expect(
      service.connect('user-1', { apiId: ' 8024 ', apiKey: ' api-key ' }),
    ).resolves.toEqual({
      connected: true,
      companyCode: 'ameex',
      provider: 'ameex.ma',
      connectedAt: connectedAt.toISOString(),
      message: 'Ameex account is connected',
    });

    expect(client.checkConnection).toHaveBeenCalledWith({
      apiId: '8024',
      apiKey: 'api-key',
    });
    expect(stored?.encryptedApiId).not.toContain('8024');
    expect(stored?.encryptedApiKey).not.toContain('api-key');
    await expect(service.getCredentials('user-1')).resolves.toEqual({
      apiId: '8024',
      apiKey: 'api-key',
    });
  });

  it('rejects blank normalized credentials before contacting Ameex', async () => {
    await expect(
      service.connect('user-1', { apiId: '8024', apiKey: ' ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(client.checkConnection).not.toHaveBeenCalled();
    expect(prisma.ameexConnection.upsert).not.toHaveBeenCalled();
  });

  it('does not store credentials rejected by Ameex', async () => {
    client.checkConnection.mockRejectedValue(new Error('rejected'));
    await expect(
      service.connect('user-1', { apiId: '8024', apiKey: 'invalid' }),
    ).rejects.toThrow('rejected');
    expect(prisma.ameexConnection.upsert).not.toHaveBeenCalled();
  });
});
