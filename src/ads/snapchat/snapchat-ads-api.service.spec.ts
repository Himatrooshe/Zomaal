import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SnapchatAdsApiService,
  SNAPCHAT_SCOPE,
} from './snapchat-ads-api.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN = '22222222-2222-4222-8222-222222222222';
const CONFIG = {
  SNAPCHAT_ADS_ENABLED: 'true',
  SNAPCHAT_ADS_CLIENT_ID: 'fake-client',
  SNAPCHAT_ADS_CLIENT_SECRET: 'fake-secret',
  SNAPCHAT_ADS_REDIRECT_URI: 'https://api.example/auth/snapchat-ads/callback',
};
const ok = (data: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function build(extra = {}) {
  return new SnapchatAdsApiService(new ConfigService({ ...CONFIG, ...extra }));
}
function wrap(
  collection: string,
  entity: string,
  items: Record<string, unknown>[],
) {
  return {
    request_status: 'SUCCESS',
    [collection]: items.map((item) => ({
      sub_request_status: 'SUCCESS',
      [entity]: item,
    })),
  };
}
function metrics(stats: Record<string, unknown> = {}) {
  return wrap('timeseries_stats', 'timeseries_stat', [
    {
      breakdown_stats: {
        campaign: [
          {
            id: CAMPAIGN,
            timeseries: [
              {
                start_time: '2026-11-01T04:00:00Z',
                stats: {
                  spend: '1234567',
                  swipes: 2,
                  impressions: 100,
                  conversion_purchases: 1,
                  ...stats,
                },
              },
            ],
          },
        ],
      },
    },
  ]);
}

describe('Snapchat reporting API', () => {
  let network: jest.SpyInstance<
    ReturnType<typeof fetch>,
    Parameters<typeof fetch>
  >;
  beforeEach(() => {
    network = jest.spyOn(global, 'fetch');
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requires enabled credentials', () => {
    expect(() =>
      build({ SNAPCHAT_ADS_ENABLED: 'false' }).assertConfigured(),
    ).toThrow(ServiceUnavailableException);
  });
  it('builds the exact marketing consent URL without exposing the secret', () => {
    const url = new URL(build().authorizationUrl('state'));
    expect(url.origin).toBe('https://accounts.snapchat.com');
    expect(url.searchParams.get('scope')).toBe(SNAPCHAT_SCOPE);
    expect(url.searchParams.get('redirect_uri')).toBe(
      CONFIG.SNAPCHAT_ADS_REDIRECT_URI,
    );
    expect(url.searchParams.get('state')).toBe('state');
    expect(url.toString()).not.toContain('fake-secret');
  });
  it('exchanges codes and tolerates the documented response without a scope field', async () => {
    network.mockResolvedValue(
      ok({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }),
    );
    const result = await build().exchange('code');
    expect(result.refreshToken).toBe('rt');
    expect(result.scopes).toEqual([SNAPCHAT_SCOPE]);
    const params = new URLSearchParams(
      (network.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(params.get('redirect_uri')).toBe(CONFIG.SNAPCHAT_ADS_REDIRECT_URI);
    expect(params.get('grant_type')).toBe('authorization_code');
  });
  it('refreshes using the refresh grant', async () => {
    network.mockResolvedValue(
      ok({
        access_token: 'at2',
        refresh_token: 'rotated',
        expires_in: 3600,
        scope: SNAPCHAT_SCOPE,
      }),
    );
    expect((await build().refresh('rt')).refreshToken).toBe('rotated');
    expect((network.mock.calls[0][1] as RequestInit).body as string).toContain(
      'grant_type=refresh_token',
    );
  });
  it.each([
    ['invalid_grant', UnauthorizedException],
    ['invalid_client', ServiceUnavailableException],
  ])('handles %s without reflecting provider secrets', async (error, kind) => {
    network.mockResolvedValue(
      ok({ error, error_description: 'never reflect sensitive contents' }, 401),
    );
    await expect(build().refresh('rt')).rejects.toBeInstanceOf(kind);
  });
  it('discovers authorized accounts and retains actual currency/timezone', async () => {
    network.mockResolvedValue(
      ok(
        wrap('organizations', 'organization', [
          {
            ad_accounts: [
              {
                id: ACCOUNT,
                name: 'Snap account',
                status: 'ACTIVE',
                currency: 'USD',
                timezone: 'America/New_York',
              },
              { id: CAMPAIGN, status: 'PENDING' },
            ],
          },
        ]),
      ),
    );
    expect(await build().accounts('at')).toEqual([
      {
        id: ACCOUNT,
        name: 'Snap account',
        currency: 'USD',
        timezone: 'America/New_York',
      },
    ]);
  });
  it('does not assume a missing currency or timezone', async () => {
    network.mockResolvedValue(
      ok(
        wrap('organizations', 'organization', [
          { ad_accounts: [{ id: ACCOUNT, status: 'ACTIVE' }] },
        ]),
      ),
    );
    await expect(build().accounts('at')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('pages campaigns and converts microcurrency exactly', async () => {
    network
      .mockResolvedValueOnce(
        ok({
          ...wrap('campaigns', 'campaign', [
            {
              id: CAMPAIGN,
              name: 'Campaign',
              status: 'ACTIVE',
              daily_budget_micro: '25000000',
            },
          ]),
          paging: {
            next_link: `https://adsapi.snapchat.com/v1/adaccounts/${ACCOUNT}/campaigns?cursor=next`,
          },
        }),
      )
      .mockResolvedValueOnce(ok(wrap('campaigns', 'campaign', [])));
    const rows = await build().campaigns('at', ACCOUNT);
    expect(rows[0].budget).toBe('25.000000');
    expect(rows[0].startDate).toBeNull();
    expect(network).toHaveBeenCalledTimes(2);
  });
  it.each([
    'https://evil.example/collect',
    `https://adsapi.snapchat.com/v1/adaccounts/${CAMPAIGN}/campaigns`,
  ])('refuses unsafe next-link %s before forwarding a token', async (next) => {
    network.mockResolvedValue(
      ok({ ...wrap('campaigns', 'campaign', []), paging: { next_link: next } }),
    );
    await expect(build().campaigns('at', ACCOUNT)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(network).toHaveBeenCalledTimes(1);
  });
  it.each([
    [401, UnauthorizedException],
    [403, ForbiddenException],
    [429, ServiceUnavailableException],
    [500, ServiceUnavailableException],
  ])('maps provider HTTP %s', async (code, kind) => {
    network.mockResolvedValue(ok({}, code));
    await expect(build().campaigns('at', ACCOUNT)).rejects.toBeInstanceOf(kind);
  });
  it('rejects partial entity responses instead of returning a truncated success', async () => {
    network.mockResolvedValue(
      ok({
        request_status: 'SUCCESS',
        campaigns: [{ sub_request_status: 'ERROR', campaign: {} }],
      }),
    );
    await expect(build().campaigns('at', ACCOUNT)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('uses account midnight across DST and labels a UTC instant as the correct local day', async () => {
    network.mockResolvedValue(ok(metrics()));
    const rows = await build().dailyMetrics(
      'at',
      ACCOUNT,
      'America/New_York',
      '2026-11-01',
      '2026-11-02',
    );
    const url = new URL(network.mock.calls[0][0] as string);
    expect(url.searchParams.get('start_time')).toBe('2026-11-01T04:00:00.000Z');
    expect(url.searchParams.get('end_time')).toBe('2026-11-02T05:00:00.000Z');
    expect(url.searchParams.get('test')).toBeNull();
    expect(url.searchParams.get('action_report_time')).toBe('conversion');
    expect(rows[0]).toMatchObject({
      campaignId: CAMPAIGN,
      date: '2026-11-01',
      spend: '1.234567',
      purchases: 1,
      reach: null,
      frequency: null,
    });
  });
  it('rejects absent required metrics instead of inventing zero values', async () => {
    network.mockResolvedValue(ok(metrics({ swipes: null })));
    await expect(
      build().dailyMetrics(
        'at',
        ACCOUNT,
        'America/New_York',
        '2026-11-01',
        '2026-11-02',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('rejects oversized synchronous windows before making requests', async () => {
    await expect(
      build().dailyMetrics('at', ACCOUNT, 'UTC', '2026-01-01', '2026-03-01'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(network).not.toHaveBeenCalled();
  });
  it('rejects unsafe numeric counts and malformed IDs', async () => {
    await expect(build().campaigns('at', '../other')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(network).not.toHaveBeenCalled();
    network.mockResolvedValue(ok(metrics({ swipes: 2147483648 })));
    await expect(
      build().dailyMetrics(
        'at',
        ACCOUNT,
        'America/New_York',
        '2026-11-01',
        '2026-11-02',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
