/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { YouCanApiService } from './youcan-api.service';
import { YouCanAuthService } from './youcan-auth.service';
import { YouCanConnectionService } from './youcan-connection.service';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';

describe('YouCanAuthService', () => {
  const activeStatus = {
    connected: true,
    storeId: 'youcan-store-id',
    displayName: 'Atlas',
    storeDomain: 'atlas.youcan.store',
    status: 'active' as const,
    grantedScopes: ['view-store-info'],
    installedAt: '2026-07-25T12:00:00.000Z',
    lastVerifiedAt: '2026-07-25T12:00:00.000Z',
    scopeUpdateRequired: false,
    message: 'YouCan store is connected',
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
      youCanConnection: {
        upsert: jest.fn().mockResolvedValue({ id: 'connection-id' }),
      },
    };
    const prisma = {
      store: {
        findUnique: jest.fn().mockResolvedValue({ id: 'zomaal-store-id' }),
      },
      youCanOAuthState: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'state-id' }),
        findUnique: jest.fn(),
      },
      youCanConnection: {
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
        key === 'YOUCAN_OAUTH_STATE_TTL_SECONDS' ? 600 : fallback,
      ),
    };
    const api = {
      assertConfigured: jest.fn(),
      getRequestedScopes: jest.fn().mockReturnValue(['view-store-info']),
      buildAuthorizationUrl: jest
        .fn()
        .mockReturnValue('https://seller-area.youcan.shop/authorize'),
      exchangeAuthorizationCode: jest.fn().mockResolvedValue({
        tokenType: 'Bearer',
        accessToken: 'plain-access-token',
        refreshToken: 'plain-refresh-token',
        accessTokenExpiresAt: new Date('2026-07-25T13:00:00.000Z'),
      }),
      getStoreDetails: jest.fn().mockResolvedValue({
        id: 'youcan-store-id',
        storeId: 'youcan-store-id',
        slug: 'atlas',
        name: 'Atlas',
        domain: 'atlas.youcan.store',
        email: 'owner@example.com',
        currencyCode: 'MAD',
        isActive: true,
      }),
    };
    const encryption = {
      assertConfigured: jest.fn(),
      encrypt: jest.fn((value: string) => `encrypted:${value}`),
    };
    const connection = {
      getStatus: jest.fn().mockResolvedValue(activeStatus),
    };
    const service = new YouCanAuthService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      api as unknown as YouCanApiService,
      encryption as unknown as YouCanTokenEncryptionService,
      connection as unknown as YouCanConnectionService,
    );

    return {
      service,
      prisma,
      transaction,
      api,
      encryption,
      connection,
    };
  }

  it('stores only a hash of the single-use state when OAuth starts', async () => {
    const { service, prisma, api } = setup();

    const result = await service.begin('user-id');
    const createInput = prisma.youCanOAuthState.create.mock.calls[0][0]
      .data as Record<string, unknown>;
    const authorizationState = api.buildAuthorizationUrl.mock.calls[0][0];

    expect(authorizationState).toHaveLength(43);
    expect(createInput.stateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createInput.stateHash).not.toBe(authorizationState);
    expect(createInput.requestedScopes).toBe('view-store-info');
    expect(result.requestedScopes).toEqual(['view-store-info']);
  });

  it('rejects an unknown or replayed OAuth state before token exchange', async () => {
    const { service, prisma, api } = setup();
    prisma.youCanOAuthState.findUnique.mockResolvedValue(null);

    await expect(
      service.complete({ state: 'replayed-state', code: 'code' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(api.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('consumes state when the seller rejects authorization', async () => {
    const { service, prisma, api } = setup();
    prisma.youCanOAuthState.findUnique.mockResolvedValue({
      stateHash: 'hash',
      requestedScopes: 'view-store-info',
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'user-id',
      storeId: 'zomaal-store-id',
    });

    await expect(
      service.complete({ state: 'valid-state', error: 'access_denied' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.youCanOAuthState.deleteMany).toHaveBeenCalledTimes(1);
    expect(api.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('verifies the YouCan store and persists only encrypted tokens', async () => {
    const { service, prisma, transaction, api, connection } = setup();
    prisma.youCanOAuthState.findUnique.mockResolvedValue({
      stateHash: 'hash',
      requestedScopes: 'view-store-info',
      expiresAt: new Date(Date.now() + 60_000),
      userId: 'user-id',
      storeId: 'zomaal-store-id',
    });

    await expect(
      service.complete({ state: 'valid-state', code: 'authorization-code' }),
    ).resolves.toEqual(activeStatus);

    expect(api.getStoreDetails).toHaveBeenCalledWith('plain-access-token');
    const upsert = transaction.youCanConnection.upsert.mock
      .calls[0][0] as Record<string, Record<string, unknown>>;
    expect(upsert.create.encryptedAccessToken).toBe(
      'encrypted:plain-access-token',
    );
    expect(upsert.create.encryptedRefreshToken).toBe(
      'encrypted:plain-refresh-token',
    );
    expect(JSON.stringify(upsert)).not.toContain('"plain-access-token"');
    expect(JSON.stringify(upsert)).not.toContain('"plain-refresh-token"');
    expect(connection.getStatus).toHaveBeenCalledWith('user-id');
  });
});
