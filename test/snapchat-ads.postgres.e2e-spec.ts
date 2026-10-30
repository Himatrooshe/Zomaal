import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import {
  ExecutionContext,
  INestApplication,
  ServiceUnavailableException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { PrismaClient, AdsPlatform, AdsConnectionStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { AccessModule } from '../src/access/access.module';
import { BillingModule } from '../src/billing/billing.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AdsController } from '../src/ads/ads.controller';
import { AdsConnectionService } from '../src/ads/ads-connection.service';
import { AdsDashboardService } from '../src/ads/ads-dashboard.service';
import { AdsTokenEncryptionService } from '../src/ads/ads-token-encryption.service';
import {
  SnapchatAdsController,
  SnapchatAdsOAuthController,
} from '../src/ads/snapchat/snapchat-ads.controller';
import {
  SnapchatAdsApiService,
  SNAPCHAT_SCOPE,
} from '../src/ads/snapchat/snapchat-ads-api.service';
import { SnapchatAdsAuthService } from '../src/ads/snapchat/snapchat-ads-auth.service';
import { SnapchatAdsService } from '../src/ads/snapchat/snapchat-ads.service';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../src/common/validation-pipe.options';

const url = process.env.SNAPCHAT_TEST_DATABASE_URL;
const postgres = url ? describe : describe.skip;
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const OTHER_CAMPAIGN = '33333333-3333-4333-8333-333333333333';
postgres('Snapchat OAuth, reporting and permissions with PostgreSQL', () => {
  let db: PrismaClient,
    pool: Pool,
    app: INestApplication,
    server: Server,
    ads: SnapchatAdsService;
  let owner: string,
    viewer: string,
    manager: string,
    outsider: string,
    actor: string | null,
    connectionId: string;
  let deniedPlan: string | undefined;
  const users: string[] = [];
  const fake = {
    assertConfigured: jest.fn(),
    isEnabled: () => true,
    authorizationUrl: (state: string) =>
      `https://accounts.snapchat.com/login/oauth2/authorize?state=${state}`,
    exchange: jest.fn().mockResolvedValue({
      accessToken: 'fake-access',
      refreshToken: 'fake-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: [SNAPCHAT_SCOPE],
    }),
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
      expiresAt: new Date(Date.now() + 3600000),
      scopes: [SNAPCHAT_SCOPE],
    }),
    accounts: jest.fn().mockResolvedValue([
      {
        id: ACCOUNT,
        name: 'Snap QA',
        currency: 'USD',
        timezone: 'America/New_York',
      },
    ]),
    campaigns: jest.fn().mockResolvedValue(
      [CAMPAIGN, OTHER_CAMPAIGN].map((id, i) => ({
        id,
        name: `Campaign ${i}`,
        status: 'ACTIVE',
        objective: 'SALES',
        budget: '10.000000',
        startDate: null,
        endDate: null,
      })),
    ),
    dailyMetrics: jest.fn(
      (_token: string, _account: string, _zone: string, from: string) =>
        Promise.resolve(
          [CAMPAIGN, OTHER_CAMPAIGN].map((campaignId) => ({
            campaignId,
            date: from,
            spend: '1.500000',
            clicks: 3,
            impressions: 100,
            purchases: 1,
            reach: null,
            frequency: null,
            raw: { resultMetric: 'conversion_purchases' },
          })),
        ),
    ),
  };
  beforeAll(async () => {
    const parsed = new URL(url!);
    if (
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      !/(test|_ci)/.test(parsed.pathname)
    )
      throw new Error('Dedicated local test database required');
    pool = new Pool({ connectionString: url });
    db = new PrismaClient({ adapter: new PrismaPg(pool) });
    for (let i = 0; i < 4; i++)
      users.push(
        (
          await db.user.create({
            data: { phone: `snapchat-test-${randomUUID()}` },
          })
        ).id,
      );
    [owner, viewer, manager, outsider] = users;
    const store = await db.store.create({
      data: {
        userId: owner,
        ownerName: 'QA',
        businessName: 'Snap QA',
        address: 'QA',
        city: 'QA',
        country: 'MA',
      },
    });
    const otherStore = await db.store.create({
      data: {
        userId: outsider,
        ownerName: 'Other',
        businessName: 'Other QA',
        address: 'QA',
        city: 'QA',
        country: 'MA',
      },
    });
    await db.user.update({
      where: { id: owner },
      data: { activeStoreId: store.id },
    });
    await db.user.update({
      where: { id: outsider },
      data: { activeStoreId: otherStore.id },
    });
    for (const userId of [owner, outsider])
      await db.subscription.create({
        data: { userId, accessEndsAt: new Date(Date.now() + 86400000) },
      });
    await db.staffMember.create({
      data: {
        userId: viewer,
        storeId: store.id,
        name: 'Viewer',
        permissionOverrides: ['ads.view'],
      },
    });
    await db.staffMember.create({
      data: {
        userId: manager,
        storeId: store.id,
        name: 'Manager',
        permissionOverrides: ['ads.view', 'ads.manage'],
      },
    });
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              ADS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
            }),
          ],
        }),
        PrismaModule,
        AccessModule,
        BillingModule,
      ],
      controllers: [
        SnapchatAdsController,
        SnapchatAdsOAuthController,
        AdsController,
      ],
      providers: [
        AdsConnectionService,
        AdsDashboardService,
        AdsTokenEncryptionService,
        SnapchatAdsAuthService,
        SnapchatAdsService,
        { provide: SnapchatAdsApiService, useValue: fake },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          if (!actor) throw new UnauthorizedException();
          ctx.switchToHttp().getRequest<{ user: { userId: string } }>().user = {
            userId: actor,
          };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS));
    await app.init();
    server = app.getHttpServer<Server>() as Server;
    ads = app.get(SnapchatAdsService);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      await db.adsOAuthState.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      if (deniedPlan) await db.plan.delete({ where: { id: deniedPlan } });
      await db.$disconnect();
    }
    if (pool) await pool.end();
  });
  const start = () => request(server).post('/ads/snapchat/auth/start');
  const refresh = () =>
    request(server).post(`/ads/snapchat/campaigns/${connectionId}/refresh`);
  const selection = (ids: string[]) =>
    request(server)
      .post(`/ads/snapchat/campaigns/${connectionId}/selection`)
      .send({ externalCampaignIds: ids });
  async function state() {
    const r = await start().expect(200);
    return new URL(
      (r.body as { authorizationUrl: string }).authorizationUrl,
    ).searchParams.get('state')!;
  }

  it('rejects unauthenticated connection requests', async () => {
    actor = null;
    await start().expect(401);
  });
  it('does not let viewers initiate account authorization', async () => {
    actor = viewer;
    await start().expect(403);
    expect(fake.exchange).not.toHaveBeenCalled();
  });
  it('keeps billing expiry enforcement on connection writes', async () => {
    actor = owner;
    await db.subscription.update({
      where: { userId: owner },
      data: { accessEndsAt: new Date(Date.now() - 1000) },
    });
    await start().expect(402);
    await db.subscription.update({
      where: { userId: owner },
      data: { accessEndsAt: new Date(Date.now() + 86400000) },
    });
  });
  it('rejects forged and missing OAuth state', async () => {
    await request(server)
      .get('/auth/snapchat-ads/callback?state=forged&code=x')
      .expect(401);
    await request(server).get('/auth/snapchat-ads/callback?code=x').expect(400);
  });
  it('rechecks management permission after consent', async () => {
    actor = manager;
    const raw = await state();
    await db.staffMember.update({
      where: { userId: manager },
      data: { permissionOverrides: ['ads.view'] },
    });
    await request(server)
      .get('/auth/snapchat-ads/callback')
      .query({ state: raw, code: 'fake-code' })
      .expect(403);
    expect(fake.exchange).not.toHaveBeenCalled();
  });
  it('consumes state once and stores encrypted renewable credentials', async () => {
    actor = owner;
    const raw = await state();
    const saved = await db.adsOAuthState.findFirstOrThrow({
      where: { userId: owner, platform: AdsPlatform.SNAPCHAT },
    });
    expect(saved.stateHash).not.toBe(raw);
    const r = await request(server)
      .get('/auth/snapchat-ads/callback')
      .query({ state: raw, code: 'fake-code' })
      .expect(200);
    const body = r.body as { connections: { id: string }[] };
    connectionId = body.connections[0].id;
    expect(JSON.stringify(body)).not.toContain('fake-access');
    expect(JSON.stringify(body)).not.toContain('fake-refresh');
    const row = await db.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(row.encryptedAccessToken).not.toBe('fake-access');
    expect(row.currency).toBe('USD');
    expect(row.timezone).toBe('America/New_York');
    await request(server)
      .get('/auth/snapchat-ads/callback')
      .query({ state: raw, code: 'fake-code' })
      .expect(401);
  });
  it('rejects malformed identifiers and reporting ranges', async () => {
    await request(server).get('/ads/snapchat/metrics/invalid').expect(400);
    await request(server)
      .get(`/ads/snapchat/metrics/${connectionId}?days=500`)
      .expect(400);
    await request(server)
      .get(`/ads/snapchat/metrics/${connectionId}?days=1&days=7`)
      .expect(400);
  });
  it('refreshes complete campaign lists without changing provider status', async () => {
    actor = owner;
    const r = await refresh().expect(200);
    expect((r.body as { data: unknown[] }).data).toHaveLength(2);
    expect(
      (
        await db.adsCampaign.findFirstOrThrow({ where: { connectionId } })
      ).budget?.toString(),
    ).toBe('10');
  });
  it('allows viewing cached campaigns but denies refresh, selection, sync and disconnect to viewers', async () => {
    actor = viewer;
    await request(server)
      .get(`/ads/snapchat/campaigns/${connectionId}`)
      .expect(200);
    await refresh().expect(403);
    await selection([CAMPAIGN]).expect(403);
    await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(403);
    await request(server)
      .delete(`/ads/connections/${connectionId}`)
      .expect(403);
  });
  it('isolates connections and tracking selection by active store', async () => {
    actor = outsider;
    await request(server)
      .get(`/ads/snapchat/metrics/${connectionId}`)
      .expect(404);
    await selection([CAMPAIGN]).expect(404);
    actor = owner;
    await selection([CAMPAIGN]).expect(200);
    await selection([ACCOUNT]).expect(404);
    expect(
      await db.adsCampaign.count({ where: { connectionId, tracked: true } }),
    ).toBe(1);
    await selection([CAMPAIGN, CAMPAIGN]).expect(400);
  });
  it('backfills 90 account-calendar days and persists only selected campaign metrics', async () => {
    const r = await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(200);
    expect((r.body as { snapshotsUpserted: number }).snapshotsUpserted).toBe(3);
    expect(fake.dailyMetrics).toHaveBeenCalledTimes(3);
    const rows = await db.adsMetricSnapshot.findMany({
      where: { campaign: { connectionId } },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.currency === 'USD')).toBe(true);
    const read = await request(server)
      .get(`/ads/snapchat/metrics/${connectionId}?days=90`)
      .expect(200);
    const body = read.body as {
      currency: string;
      timezone: string;
      campaigns: { spent: string; purchases: number }[];
    };
    expect(body.currency).toBe('USD');
    expect(body.timezone).toBe('America/New_York');
    expect(body.campaigns[0].spent).toBe('4.5000');
    expect(body.campaigns[0].purchases).toBe(3);
  });
  it('removes stale last-window values when a successful provider report becomes empty', async () => {
    fake.dailyMetrics.mockResolvedValueOnce([]);
    await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(200);
    expect(
      await db.adsMetricSnapshot.count({
        where: { campaign: { connectionId } },
      }),
    ).toBe(2);
  });
  it('backfills newly selected campaigns and preserves freshness for unchanged selections', async () => {
    const before = await db.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    await selection([CAMPAIGN]).expect(200);
    expect(
      (
        await db.adsConnection.findUniqueOrThrow({
          where: { id: connectionId },
        })
      ).lastSyncedAt,
    ).toEqual(before.lastSyncedAt);
    await selection([OTHER_CAMPAIGN]).expect(200);
    expect(
      (
        await db.adsConnection.findUniqueOrThrow({
          where: { id: connectionId },
        })
      ).lastSyncedAt,
    ).toBeNull();
    const calls = fake.dailyMetrics.mock.calls.length;
    await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(200);
    expect(fake.dailyMetrics.mock.calls.length - calls).toBe(3);
  });
  it('does not erase stored data after a provider error and releases its sync lease', async () => {
    const before = await db.adsMetricSnapshot.count({
      where: { campaign: { connectionId } },
    });
    fake.dailyMetrics.mockRejectedValueOnce(
      new ServiceUnavailableException('Snapchat unavailable'),
    );
    await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(503);
    expect(
      await db.adsMetricSnapshot.count({
        where: { campaign: { connectionId } },
      }),
    ).toBe(before);
    expect(
      (
        await db.adsConnection.findUniqueOrThrow({
          where: { id: connectionId },
        })
      ).syncStartedAt,
    ).toBeNull();
  });
  it('serializes refresh rotation so two simultaneous requests only refresh once', async () => {
    await db.adsConnection.update({
      where: { id: connectionId },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    const current = await db.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    const auth = app.get(SnapchatAdsAuthService);
    const tokens = await Promise.all([
      auth.getValidAccessToken(current),
      auth.getValidAccessToken(current),
    ]);
    expect(tokens).toEqual(['rotated-access', 'rotated-access']);
    expect(fake.refresh).toHaveBeenCalledTimes(1);
  });
  it('skips a connected owner who no longer has an ads entitlement', async () => {
    deniedPlan = (
      await db.plan.create({
        data: {
          code: `QA_${randomUUID()}`,
          name: 'No ads',
          monthlyPrice: 1,
          features: [],
          featureList: [],
        },
      })
    ).id;
    await db.subscription.update({
      where: { userId: owner },
      data: { planId: deniedPlan },
    });
    const calls = fake.dailyMetrics.mock.calls.length;
    await ads.syncAll();
    expect(fake.dailyMetrics.mock.calls.length).toBe(calls);
    await db.subscription.update({
      where: { userId: owner },
      data: { planId: null },
    });
  });
  it('commits revoked-token state before asking the merchant to reconnect', async () => {
    await db.adsConnection.update({
      where: { id: connectionId },
      data: { accessTokenExpiresAt: new Date(Date.now() - 1000) },
    });
    fake.refresh.mockRejectedValueOnce(new UnauthorizedException('revoked'));
    await request(server)
      .post(`/ads/snapchat/sync/${connectionId}`)
      .expect(409);
    const row = await db.adsConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });
    expect(row.status).toBe(AdsConnectionStatus.REAUTHORIZATION_REQUIRED);
    expect(row.encryptedRefreshToken).toBeNull();
  });
});
