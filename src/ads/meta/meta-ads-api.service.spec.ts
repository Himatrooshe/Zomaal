import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import { MetaAdsApiService, metaResultCount } from './meta-ads-api.service';

const CONFIG: Record<string, string> = {
  META_ADS_ENABLED: 'true',
  META_ADS_APP_ID: 'test-app-id',
  META_ADS_APP_SECRET: 'test-app-secret',
  META_ADS_REDIRECT_URI: 'https://api.example.test/auth/meta-ads/callback',
};

function build(overrides: Record<string, string | undefined> = {}) {
  const values = { ...CONFIG, ...overrides };
  const config = { get: jest.fn((key: string) => values[key]) };
  return new MetaAdsApiService(config as never);
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function calledUrl(fetchMock: jest.Mock, call = 0): URL {
  return new URL((fetchMock.mock.calls[call] as [string])[0]);
}

describe('MetaAdsApiService', () => {
  let fetchMock: jest.Mock;
  const realFetch = global.fetch;

  afterAll(() => {
    global.fetch = realFetch;
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('refuses to run when disabled', () => {
    expect(() =>
      build({ META_ADS_ENABLED: 'false' }).assertConfigured(),
    ).toThrow(ServiceUnavailableException);
  });

  it('falls back to the shared Meta app credentials', () => {
    expect(() =>
      build({
        META_ADS_APP_ID: '',
        META_ADS_APP_SECRET: '',
        META_APP_ID: 'shared-id',
        META_APP_SECRET: 'shared-secret',
      }).assertConfigured(),
    ).not.toThrow();
    expect(() =>
      build({ META_ADS_APP_ID: '', META_APP_ID: '' }).assertConfigured(),
    ).toThrow(ServiceUnavailableException);
  });

  it('builds the Facebook Login URL with ads permissions and state', () => {
    const url = new URL(build().buildAuthorizationUrl('state-123'));
    expect(url.origin + url.pathname).toBe(
      'https://www.facebook.com/v25.0/dialog/oauth',
    );
    expect(url.searchParams.get('scope')).toBe('ads_read,ads_management');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('client_id')).toBe('test-app-id');
    expect(url.searchParams.get('config_id')).toBeNull();
  });

  it('uses a Login for Business configuration instead of a scope list', () => {
    const url = new URL(
      build({ META_ADS_CONFIG_ID: 'cfg-1' }).buildAuthorizationUrl('s'),
    );
    expect(url.searchParams.get('config_id')).toBe('cfg-1');
    expect(url.searchParams.get('scope')).toBeNull();
  });

  it('swaps the code for a long-lived token', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'short', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { access_token: 'long', expires_in: 5_184_000 }),
      );
    const tokens = await build().exchangeAuthorizationCode('code-1');
    expect(tokens.accessToken).toBe('long');
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(
      Date.now() + 59 * 86_400_000,
    );
    expect(calledUrl(fetchMock, 0).searchParams.get('code')).toBe('code-1');
    const second = calledUrl(fetchMock, 1).searchParams;
    expect(second.get('grant_type')).toBe('fb_exchange_token');
    expect(second.get('fb_exchange_token')).toBe('short');
  });

  it('keeps the original token when it cannot be extended', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: 'biz' }))
      .mockResolvedValueOnce(
        jsonResponse(400, { error: { message: 'Unsupported', code: 1000 } }),
      );
    const tokens = await build().exchangeAuthorizationCode('code-1');
    expect(tokens).toEqual({ accessToken: 'biz', expiresAt: null });
  });

  it('treats a used or expired code as an authorization failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          message: 'Code has been used',
          code: 100,
          error_subcode: 36009,
        },
      }),
    );
    await expect(
      build().exchangeAuthorizationCode('code-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reports wrong app credentials as a server problem', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: { message: 'Error validating client secret.', code: 1 },
      }),
    );
    await expect(
      build().exchangeAuthorizationCode('code-1'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('signs every Graph call with appsecret_proof', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          { permission: 'ads_read', status: 'granted' },
          { permission: 'ads_management', status: 'declined' },
        ],
      }),
    );
    const granted = await build().getGrantedPermissions('user-token');
    expect(granted).toEqual(['ads_read']);
    const params = calledUrl(fetchMock).searchParams;
    expect(params.get('appsecret_proof')).toBe(
      createHmac('sha256', 'test-app-secret')
        .update('user-token')
        .digest('hex'),
    );
  });

  it('lists only ad accounts that can still spend, following cursors', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            {
              account_id: '111',
              name: 'Main',
              currency: 'MAD',
              timezone_name: 'Africa/Casablanca',
              account_status: 1,
            },
            { account_id: '222', name: 'Closed', account_status: 101 },
            { account_id: '333', name: 'Disabled', account_status: 2 },
          ],
          paging: {
            cursors: { after: 'c1' },
            next: 'https://graph.facebook.com/next',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [{ account_id: '444', name: 'Grace', account_status: 9 }],
          paging: { cursors: { after: 'c2' } },
        }),
      );
    const accounts = await build().listAdAccounts('t');
    expect(accounts.map((a) => a.accountId)).toEqual(['111', '444']);
    expect(accounts[0]).toEqual({
      accountId: '111',
      name: 'Main',
      currency: 'MAD',
      timezone: 'Africa/Casablanca',
    });
    expect(calledUrl(fetchMock, 1).searchParams.get('after')).toBe('c1');
    expect(calledUrl(fetchMock, 1).origin).toBe('https://graph.facebook.com');
  });

  it('converts budgets from the smallest currency unit and skips archived', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: '9',
            name: 'B sales',
            status: 'ACTIVE',
            objective: 'OUTCOME_SALES',
            daily_budget: '15050',
          },
          {
            id: '8',
            name: 'A leads',
            status: 'PAUSED',
            lifetime_budget: '200000',
            start_time: '2026-10-01T00:00:00+0000',
          },
          { id: '7', name: 'Old', status: 'ARCHIVED' },
          { id: '6', name: 'Ad set budget', status: 'ACTIVE' },
        ],
      }),
    );
    const campaigns = await build().listCampaigns('t', '111', 'MAD');
    expect(campaigns.map((c) => [c.name, c.budget])).toEqual([
      ['A leads', 2000],
      ['Ad set budget', null],
      ['B sales', 150.5],
    ]);
    expect(campaigns[0].startDate?.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(calledUrl(fetchMock).pathname).toBe('/v25.0/act_111/campaigns');
  });

  it('uses currencies without minor units as they are', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: '1', name: 'X', status: 'ACTIVE', daily_budget: '5000' }],
      }),
    );
    const [campaign] = await build().listCampaigns('t', '111', 'JPY');
    expect(campaign.budget).toBe(5000);
  });

  it('reads daily campaign insights with link clicks and actions', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            campaign_id: '9',
            date_start: '2026-10-17',
            spend: '120.50',
            inline_link_clicks: '40',
            impressions: '5000',
            reach: '3000',
            frequency: '1.6667',
            cpm: '24.1',
            inline_link_click_ctr: '0.8',
            actions: [
              { action_type: 'link_click', value: '40' },
              { action_type: 'omni_purchase', value: '4' },
            ],
          },
        ],
      }),
    );
    const [day] = await build().getDailyInsights(
      't',
      '111',
      ['9', 'bad id'],
      '2026-09-19',
      '2026-10-17',
    );
    expect(day).toMatchObject({
      date: '2026-10-17',
      externalCampaignId: '9',
      spend: 120.5,
      linkClicks: 40,
      impressions: 5000,
      reach: 3000,
      frequency: 1.6667,
      cpm: 24.1,
      ctr: 0.8,
      actions: { link_click: 40, omni_purchase: 4 },
    });
    const params = calledUrl(fetchMock).searchParams;
    expect(params.get('level')).toBe('campaign');
    expect(params.get('time_increment')).toBe('1');
    expect(JSON.parse(params.get('time_range')!)).toEqual({
      since: '2026-09-19',
      until: '2026-10-17',
    });
    expect(JSON.parse(params.get('filtering')!)).toEqual([
      { field: 'campaign.id', operator: 'IN', value: ['9'] },
    ]);
  });

  it('skips the insights call when no campaign id is valid', async () => {
    await expect(
      build().getDailyInsights('t', '111', ['x'], '2026-10-01', '2026-10-02'),
    ).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pauses a campaign with a signed POST', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }));
    await build().setCampaignStatus('t', '9', 'PAUSED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v25.0/9');
    expect(init.method).toBe('POST');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('status')).toBe('PAUSED');
    expect(body.get('appsecret_proof')).toBeTruthy();
  });

  it.each([
    [400, { code: 190, message: 'Session expired' }, UnauthorizedException],
    [
      400,
      { code: 17, message: 'User request limit reached' },
      ServiceUnavailableException,
    ],
    [
      400,
      { code: 80004, message: 'Too many calls' },
      ServiceUnavailableException,
    ],
    [
      503,
      { code: 2, message: 'Service temporarily unavailable' },
      ServiceUnavailableException,
    ],
    [403, { code: 200, message: 'Permissions error' }, ForbiddenException],
    [400, { code: 100, message: 'Invalid parameter' }, BadGatewayException],
  ])('maps HTTP %s / Graph error %j', async (status, error, expected) => {
    fetchMock.mockResolvedValue(jsonResponse(status, { error }));
    await expect(
      build().setCampaignStatus('t', '9', 'ACTIVE'),
    ).rejects.toBeInstanceOf(expected);
  });

  it('turns a network failure into 503', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(build().getGrantedPermissions('t')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('metaResultCount', () => {
  const actions = {
    link_click: 50,
    omni_purchase: 4,
    purchase: 4,
    lead: 2,
    'onsite_conversion.messaging_conversation_started_7d': 7,
  };

  it.each([
    ['OUTCOME_SALES', 4],
    ['OUTCOME_LEADS', 2],
    ['OUTCOME_ENGAGEMENT', 7],
    ['OUTCOME_TRAFFIC', 50],
    [null, 4],
  ])(
    '%s → %d (overlapping purchase types are not added)',
    (objective, expected) => {
      expect(metaResultCount(objective, actions)).toBe(expected);
    },
  );

  it('is 0 when the objective has no matching action', () => {
    expect(metaResultCount('OUTCOME_AWARENESS', actions)).toBe(0);
    expect(metaResultCount('OUTCOME_SALES', { link_click: 3 })).toBe(0);
  });
});
