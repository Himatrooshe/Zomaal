import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform } from '@prisma/client';
import { createHash } from 'crypto';
import { GoogleAdsAuthService } from './google-ads-auth.service';
import { GOOGLE_ADS_SCOPE } from './google-ads-api.service';

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
      update: jest.fn(),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'GOOGLE_ADS_AUTH_SUCCESS_REDIRECT_URL'
        ? 'https://app.example.test/ads'
        : undefined,
    ),
  };
  const googleApi = {
    assertConfigured: jest.fn(),
    buildAuthorizationUrl: jest.fn(
      (state: string) => `https://accounts.google.com/x?state=${state}`,
    ),
    exchangeAuthorizationCode: jest.fn(),
    refreshAccessToken: jest.fn(),
    listAccessibleCustomerIds: jest.fn(),
    getCustomer: jest.fn(),
    isUnauthorizedError: (e: unknown) => e instanceof UnauthorizedException,
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
  const service = new GoogleAdsAuthService(
    prisma as never,
    config as never,
    googleApi as never,
    encryption as never,
    connections as never,
    storeAccess as never,
  );
  return { service, prisma, googleApi, encryption, connections };
}

function validState(ctx: ReturnType<typeof build>) {
  ctx.prisma.adsOAuthState.findUnique.mockResolvedValue({
    stateHash: STATE_HASH,
    platform: AdsPlatform.GOOGLE,
    storeId: 'store-1',
    expiresAt: new Date(Date.now() + 60_000),
  });
  ctx.googleApi.exchangeAuthorizationCode.mockResolvedValue({
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date(Date.now() + 3_600_000),
    scope: [GOOGLE_ADS_SCOPE],
  });
}

const advertiser = (id: string, extra: Record<string, unknown> = {}) => ({
  customerId: id,
  name: `Account ${id}`,
  currency: 'MAD',
  timezone: 'Africa/Casablanca',
  isManager: false,
  isTestAccount: false,
  status: 'ENABLED',
  ...extra,
});

describe('GoogleAdsAuthService', () => {
  it('begin stores a hashed single-use state and returns the Google URL', async () => {
    const ctx = build();
    const res = await ctx.service.begin('user-1');
    const created = ctx.prisma.adsOAuthState.create.mock.calls[0] as [
      { data: { stateHash: string; platform: string } },
    ];
    expect(created[0].data.platform).toBe('GOOGLE');
    const raw = new URL(res.authorizationUrl).searchParams.get('state')!;
    expect(created[0].data.stateHash).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
  });

  describe('complete', () => {
    it('rejects an unknown or reused state', async () => {
      const ctx = build();
      ctx.prisma.adsOAuthState.findUnique.mockResolvedValue(null);
      await expect(
        ctx.service.complete({ state: STATE, code: 'c' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a cancelled consent', async () => {
      const ctx = build();
      validState(ctx);
      await expect(
        ctx.service.complete({ state: STATE, error: 'access_denied' }),
      ).rejects.toThrow('Google authorization was canceled or rejected');
      expect(ctx.googleApi.exchangeAuthorizationCode).not.toHaveBeenCalled();
    });

    it('requires the adwords scope', async () => {
      const ctx = build();
      validState(ctx);
      ctx.googleApi.exchangeAuthorizationCode.mockResolvedValue({
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: new Date(),
        scope: ['openid'],
      });
      await expect(
        ctx.service.complete({ state: STATE, code: 'c' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stores one encrypted connection per enabled advertiser, skipping managers', async () => {
      const ctx = build();
      validState(ctx);
      ctx.googleApi.listAccessibleCustomerIds.mockResolvedValue([
        '111',
        '222',
        '333',
      ]);
      ctx.googleApi.getCustomer.mockImplementation((_t: string, id: string) =>
        id === '222'
          ? advertiser(id, { isManager: true })
          : id === '333'
            ? advertiser(id, { status: 'CANCELED' })
            : advertiser(id),
      );

      const { connections } = await ctx.service.complete({
        state: STATE,
        code: 'c',
      });

      expect(connections.map((c) => c.externalAdvertiserId)).toEqual(['111']);
      const upsert = ctx.prisma.adsConnection.upsert.mock.calls[0] as [
        { create: Record<string, unknown> },
      ];
      expect(upsert[0].create).toMatchObject({
        platform: 'GOOGLE',
        status: AdsConnectionStatus.ACTIVE,
        currency: 'MAD',
        encryptedAccessToken: 'enc(at|ads:GOOGLE:111:access-token)',
        encryptedRefreshToken: 'enc(rt|ads:GOOGLE:111:refresh-token)',
      });
    });

    it('explains when only manager accounts are accessible', async () => {
      const ctx = build();
      validState(ctx);
      ctx.googleApi.listAccessibleCustomerIds.mockResolvedValue(['222']);
      ctx.googleApi.getCustomer.mockResolvedValue(
        advertiser('222', { isManager: true }),
      );
      await expect(
        ctx.service.complete({ state: STATE, code: 'c' }),
      ).rejects.toThrow(/Manager \(MCC\) accounts are not supported yet/);
    });

    it("surfaces Google's reason when no account could be read", async () => {
      const ctx = build();
      validState(ctx);
      ctx.googleApi.listAccessibleCustomerIds.mockResolvedValue(['111']);
      ctx.googleApi.getCustomer.mockRejectedValue(
        new ForbiddenException('Google Ads: developer token not approved'),
      );
      await expect(
        ctx.service.complete({ state: STATE, code: 'c' }),
      ).rejects.toThrow('developer token not approved');
    });
  });

  describe('getValidAccessToken', () => {
    const base = {
      id: 'conn-1',
      platform: AdsPlatform.GOOGLE,
      externalAdvertiserId: '111',
      status: AdsConnectionStatus.ACTIVE,
      encryptedAccessToken: 'enc(old|x)',
      encryptedRefreshToken: 'enc(rt|y)',
    };

    it('uses the stored token while it is fresh', async () => {
      const ctx = build();
      const token = await ctx.service.getValidAccessToken({
        ...base,
        accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
      } as never);
      expect(token).toBe('old');
      expect(ctx.googleApi.refreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes and persists a token that is about to expire', async () => {
      const ctx = build();
      ctx.googleApi.refreshAccessToken.mockResolvedValue({
        accessToken: 'new',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000),
        scope: [],
      });
      const token = await ctx.service.getValidAccessToken({
        ...base,
        accessTokenExpiresAt: new Date(Date.now() + 30_000),
      } as never);
      expect(token).toBe('new');
      expect(ctx.googleApi.refreshAccessToken).toHaveBeenCalledWith('rt');
      expect(ctx.prisma.adsConnection.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'conn-1' } }),
      );
    });

    it('marks the connection for reconnect when the grant was revoked', async () => {
      const ctx = build();
      ctx.googleApi.refreshAccessToken.mockRejectedValue(
        new UnauthorizedException(),
      );
      await expect(
        ctx.service.getValidAccessToken({
          ...base,
          accessTokenExpiresAt: null,
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ctx.connections.markReauthorizationRequired).toHaveBeenCalledWith(
        'conn-1',
      );
    });

    it('refuses a connection that is not active', async () => {
      const ctx = build();
      await expect(
        ctx.service.getValidAccessToken({
          ...base,
          status: AdsConnectionStatus.DISCONNECTED,
        } as never),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('appends google_ads=connected to the success redirect', () => {
    expect(build().service.getSuccessRedirectUrl()).toBe(
      'https://app.example.test/ads?google_ads=connected',
    );
  });
});
