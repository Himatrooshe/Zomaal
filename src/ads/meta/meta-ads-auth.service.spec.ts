import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform } from '@prisma/client';
import { createHash } from 'crypto';
import { MetaAdsAuthService } from './meta-ads-auth.service';

const STATE = 'raw-state';
const STATE_HASH = createHash('sha256').update(STATE).digest('hex');

function build() {
  const prisma = {
    adsOAuthState: {
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    adsConnection: {
      upsert: jest.fn(({ create }: { create: Record<string, unknown> }) => ({
        id: `conn-${String(create.externalAdvertiserId)}`,
        installedAt: new Date('2026-10-06T00:00:00.000Z'),
        lastSyncedAt: null,
        lastSyncError: null,
        ...create,
      })),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'META_ADS_AUTH_SUCCESS_REDIRECT_URL'
        ? 'https://app.example.test/ads'
        : undefined,
    ),
  };
  const metaApi = {
    assertConfigured: jest.fn(),
    buildAuthorizationUrl: jest.fn(
      (state: string) => `https://www.facebook.com/x?state=${state}`,
    ),
    exchangeAuthorizationCode: jest.fn(),
    getGrantedPermissions: jest.fn(),
    listAdAccounts: jest.fn(),
  };
  const encryption = {
    assertConfigured: jest.fn(),
    encrypt: jest.fn(
      (value: string, context: string) => `enc(${value}|${context})`,
    ),
    decrypt: jest.fn(
      (value: string) => value.replace(/^enc\(/, '').split('|')[0],
    ),
  };
  const connections = { markReauthorizationRequired: jest.fn() };
  const storeAccess = {
    requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
  };
  const service = new MetaAdsAuthService(
    prisma as never,
    config as never,
    metaApi as never,
    encryption as never,
    connections as never,
    storeAccess as never,
  );
  return { service, prisma, metaApi, encryption, connections };
}

function validState(ctx: ReturnType<typeof build>) {
  ctx.prisma.adsOAuthState.findUnique.mockResolvedValue({
    stateHash: STATE_HASH,
    platform: AdsPlatform.META,
    storeId: 'store-1',
    expiresAt: new Date(Date.now() + 60_000),
  });
  ctx.metaApi.exchangeAuthorizationCode.mockResolvedValue({
    accessToken: 'long-token',
    expiresAt: new Date(Date.now() + 60 * 86_400_000),
  });
  ctx.metaApi.getGrantedPermissions.mockResolvedValue([
    'ads_read',
    'ads_management',
  ]);
}

const account = (id: string) => ({
  accountId: id,
  name: `Account ${id}`,
  currency: 'MAD',
  timezone: 'Africa/Casablanca',
});

function upsertCall(ctx: ReturnType<typeof build>, index: number) {
  return (
    ctx.prisma.adsConnection.upsert.mock.calls[index] as [
      {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      },
    ]
  )[0];
}

describe('MetaAdsAuthService', () => {
  it('begin stores a hashed single-use state and returns the Facebook URL', async () => {
    const ctx = build();
    const res = await ctx.service.begin('user-1');
    const created = (
      ctx.prisma.adsOAuthState.create.mock.calls[0] as [
        { data: { stateHash: string; platform: string } },
      ]
    )[0];
    expect(created.data.platform).toBe('META');
    const raw = new URL(res.authorizationUrl).searchParams.get('state')!;
    expect(created.data.stateHash).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
    expect(created.data.stateHash).not.toBe(raw);
  });

  it('stores one encrypted connection per ad account', async () => {
    const ctx = build();
    validState(ctx);
    ctx.metaApi.listAdAccounts.mockResolvedValue([
      account('111'),
      account('222'),
    ]);

    const res = await ctx.service.complete({ state: STATE, code: 'code-1' });

    expect(res.connections.map((c) => c.externalAdvertiserId)).toEqual([
      '111',
      '222',
    ]);
    const first = upsertCall(ctx, 0);
    expect(first.create).toMatchObject({
      storeId: 'store-1',
      platform: AdsPlatform.META,
      status: AdsConnectionStatus.ACTIVE,
      currency: 'MAD',
      encryptedAccessToken: 'enc(long-token|ads:META:111:access-token)',
      encryptedRefreshToken: null,
      grantedScopes: 'ads_read,ads_management',
    });
    expect(first.update).toMatchObject({
      disconnectedAt: null,
      lastSyncError: null,
    });
  });

  it('refuses when ads access was not granted', async () => {
    const ctx = build();
    validState(ctx);
    ctx.metaApi.getGrantedPermissions.mockResolvedValue(['public_profile']);
    await expect(
      ctx.service.complete({ state: STATE, code: 'code-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.metaApi.listAdAccounts).not.toHaveBeenCalled();
  });

  it('refuses when the user has no usable ad account', async () => {
    const ctx = build();
    validState(ctx);
    ctx.metaApi.listAdAccounts.mockResolvedValue([]);
    await expect(
      ctx.service.complete({ state: STATE, code: 'code-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.prisma.adsConnection.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown', null],
    ['another platform', { platform: AdsPlatform.GOOGLE }],
    ['expired', { expiresAt: new Date(Date.now() - 1000) }],
  ])('rejects an %s state', async (_label, override) => {
    const ctx = build();
    ctx.prisma.adsOAuthState.findUnique.mockResolvedValue(
      override && {
        stateHash: STATE_HASH,
        platform: AdsPlatform.META,
        storeId: 'store-1',
        expiresAt: new Date(Date.now() + 60_000),
        ...override,
      },
    );
    await expect(
      ctx.service.complete({ state: STATE, code: 'code-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.metaApi.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects a state that was already consumed', async () => {
    const ctx = build();
    validState(ctx);
    ctx.prisma.adsOAuthState.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      ctx.service.complete({ state: STATE, code: 'code-1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats a cancelled Facebook dialog as rejected', async () => {
    const ctx = build();
    validState(ctx);
    await expect(
      ctx.service.complete({ state: STATE, error: 'access_denied' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ctx.metaApi.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects array query parameters', async () => {
    const ctx = build();
    await expect(
      ctx.service.complete({ state: [STATE, 'x'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('getValidAccessToken', () => {
    const connection = (extra: Record<string, unknown> = {}) =>
      ({
        id: 'conn-1',
        platform: AdsPlatform.META,
        status: AdsConnectionStatus.ACTIVE,
        externalAdvertiserId: '111',
        encryptedAccessToken: 'enc(tok|ads:META:111:access-token)',
        accessTokenExpiresAt: new Date(Date.now() + 86_400_000),
        ...extra,
      }) as never;

    it('decrypts a token that has not expired', async () => {
      const ctx = build();
      await expect(ctx.service.getValidAccessToken(connection())).resolves.toBe(
        'tok',
      );
    });

    it('accepts a token with no expiry', async () => {
      const ctx = build();
      await expect(
        ctx.service.getValidAccessToken(
          connection({ accessTokenExpiresAt: null }),
        ),
      ).resolves.toBe('tok');
    });

    it('flags an expired token for reconnection', async () => {
      const ctx = build();
      await expect(
        ctx.service.getValidAccessToken(
          connection({ accessTokenExpiresAt: new Date(Date.now() - 1000) }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.connections.markReauthorizationRequired).toHaveBeenCalledWith(
        'conn-1',
      );
    });

    it('refuses a connection that needs reconnecting', async () => {
      const ctx = build();
      await expect(
        ctx.service.getValidAccessToken(
          connection({
            status: AdsConnectionStatus.REAUTHORIZATION_REQUIRED,
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('adds meta_ads=connected to the success redirect', () => {
    const ctx = build();
    expect(ctx.service.getSuccessRedirectUrl()).toBe(
      'https://app.example.test/ads?meta_ads=connected',
    );
    expect(ctx.service.getFailureRedirectUrl()).toBeNull();
  });
});
