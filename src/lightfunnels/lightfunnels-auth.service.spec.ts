/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LightfunnelsApiService } from './lightfunnels-api.service';
import { LightfunnelsAuthService } from './lightfunnels-auth.service';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';

describe('LightfunnelsAuthService', () => {
  const activeStatus = {
    connected: true,
    accountId: 'lightfunnels-account-id',
    displayName: 'Atlas',
    storeDomain: 'atlas.lightfunnels.com',
    status: 'active' as const,
    grantedScopes: ['funnels', 'orders'],
    installedAt: '2026-07-26T12:00:00.000Z',
    lastVerifiedAt: '2026-07-26T12:00:00.000Z',
    scopeUpdateRequired: false,
    message: 'Lightfunnels account is connected',
  };

  function setup() {
    const transaction = {
      ecommerceConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'ecommerce-id' }),
      },
      ecommerceOrder: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      lightfunnelsConnection: {
        upsert: jest.fn().mockResolvedValue({ id: 'connection-id' }),
      },
    };
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'zomaal-store-id' }),
      },
      lightfunnelsOAuthState: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'state-id' }),
        findUnique: jest.fn(),
      },
      lightfunnelsConnection: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (input: unknown) => {
        if (typeof input === 'function') {
          const callback = input as (
            client: typeof transaction,
          ) => Promise<unknown>;
          return callback(transaction);
        }
        return Promise.all(input as Promise<unknown>[]);
      }),
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) =>
        key === 'LIGHTFUNNELS_OAUTH_STATE_TTL_SECONDS' ? 600 : fallback,
      ),
    };
    const api = {
      assertConfigured: jest.fn(),
      getRequestedScopes: jest.fn().mockReturnValue(['funnels', 'orders']),
      buildAuthorizationUrl: jest
        .fn()
        .mockReturnValue('https://app.lightfunnels.com/admin/oauth'),
      exchangeAuthorizationCode: jest
        .fn()
        .mockResolvedValue('plain-access-token'),
      getAccountDetails: jest.fn().mockResolvedValue({
        accountId: 'lightfunnels-account-id',
        stores: [
          {
            id: 'lightfunnels-store-id',
            uid: 'store-uid',
            name: 'Atlas',
            slug: 'atlas',
            domain: 'atlas.lightfunnels.com',
          },
        ],
      }),
    };
    const connection = {
      getStatus: jest.fn().mockResolvedValue(activeStatus),
    };
    const encryption = {
      assertConfigured: jest.fn(),
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    };
    const service = new LightfunnelsAuthService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      api as unknown as LightfunnelsApiService,
      connection as unknown as LightfunnelsConnectionService,
      encryption as unknown as LightfunnelsTokenEncryptionService,
    );

    return { service, prisma, transaction, api, connection };
  }

  it('stores only a hash of the single-use state when OAuth starts', async () => {
    const { service, prisma, api } = setup();

    const result = await service.begin('user-id');
    const createInput =
      prisma.lightfunnelsOAuthState.create.mock.calls[0][0].data;
    const authorizationState = api.buildAuthorizationUrl.mock.calls[0][0];

    expect(authorizationState).toHaveLength(43);
    expect(createInput.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createInput.stateHash).not.toBe(authorizationState);
    expect(createInput.requestedScopes).toBe('funnels,orders');
    expect(result.requestedScopes).toEqual(['funnels', 'orders']);
  });

  it('rejects an unknown or replayed state before token exchange', async () => {
    const { service, prisma, api } = setup();
    prisma.lightfunnelsOAuthState.findUnique.mockResolvedValue(null);

    await expect(
      service.complete({ state: 'replayed-state', code: 'code' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(api.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('consumes state when the merchant rejects authorization', async () => {
    const { service, prisma, api } = setup();
    prisma.lightfunnelsOAuthState.findUnique.mockResolvedValue({
      stateHash: 'hash',
      requestedScopes: 'funnels,orders',
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'user-id',
      storeId: 'zomaal-store-id',
    });

    await expect(
      service.complete({ state: 'valid-state', error: 'access_denied' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.lightfunnelsOAuthState.deleteMany).toHaveBeenCalledTimes(1);
    expect(api.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('verifies the account and persists only an encrypted token', async () => {
    const { service, prisma, transaction, api, connection } = setup();
    prisma.lightfunnelsOAuthState.findUnique.mockResolvedValue({
      stateHash: 'hash',
      requestedScopes: 'funnels,orders',
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'user-id',
      storeId: 'zomaal-store-id',
    });

    await expect(
      service.complete({ state: 'valid-state', code: 'authorization-code' }),
    ).resolves.toEqual(activeStatus);

    expect(api.getAccountDetails).toHaveBeenCalledWith('plain-access-token');
    const upsert = transaction.lightfunnelsConnection.upsert.mock
      .calls[0][0] as Record<string, Record<string, unknown>>;
    expect(upsert.create.encryptedAccessToken).toBe(
      'encrypted:plain-access-token',
    );
    expect(JSON.stringify(upsert)).not.toContain('"plain-access-token"');
    expect(connection.getStatus).toHaveBeenCalledWith('user-id');
  });
});
