import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GOOGLE_ADS_SCOPE,
  GoogleAdsApiService,
} from './google-ads-api.service';

const CONFIG: Record<string, string> = {
  GOOGLE_ADS_ENABLED: 'true',
  GOOGLE_ADS_CLIENT_ID: 'test-client-id',
  GOOGLE_ADS_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_ADS_DEVELOPER_TOKEN: 'test-dev-token',
  GOOGLE_ADS_REDIRECT_URI: 'https://api.example.test/auth/google-ads/callback',
};

function build(overrides: Record<string, string | undefined> = {}) {
  const values = { ...CONFIG, ...overrides };
  const config = { get: jest.fn((key: string) => values[key]) };
  return new GoogleAdsApiService(config as never);
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

describe('GoogleAdsApiService', () => {
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
      build({ GOOGLE_ADS_ENABLED: 'false' }).assertConfigured(),
    ).toThrow(ServiceUnavailableException);
  });

  it('runs without a developer token', () => {
    expect(() =>
      build({ GOOGLE_ADS_DEVELOPER_TOKEN: '' }).assertConfigured(),
    ).not.toThrow();
  });

  it('builds an offline consent URL with the adwords scope and state', () => {
    const url = new URL(build().buildAuthorizationUrl('state-123'));
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('scope')).toBe(GOOGLE_ADS_SCOPE);
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
  });

  it('exchanges the code and parses the token set', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3599,
        scope: GOOGLE_ADS_SCOPE,
      }),
    );
    const tokens = await build().exchangeAuthorizationCode('code-1');
    expect(tokens).toMatchObject({
      accessToken: 'at',
      refreshToken: 'rt',
      scope: [GOOGLE_ADS_SCOPE],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(init.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_secret')).toBe('test-client-secret');
  });

  it('maps invalid_grant to Unauthorized (revoked refresh token)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    await expect(build().refreshAccessToken('rt')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('maps invalid_client to ServiceUnavailable, not a merchant reauth', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'invalid_client' }));
    const api = build();
    const error: unknown = await api
      .refreshAccessToken('rt')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(api.isUnauthorizedError(error)).toBe(false);
  });

  it('lists accessible customer ids', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        resourceNames: ['customers/1234567890', 'customers/bad'],
      }),
    );
    await expect(build().listAccessibleCustomerIds('at')).resolves.toEqual([
      '1234567890',
    ]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://googleads.googleapis.com/v25/customers:listAccessibleCustomers',
    );
    expect((init.headers as Record<string, string>)['developer-token']).toBe(
      'test-dev-token',
    );
  });

  it('omits the developer-token header when not configured', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { resourceNames: [] }));
    await build({
      GOOGLE_ADS_DEVELOPER_TOKEN: '',
    }).listAccessibleCustomerIds('at');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty(
      'developer-token',
    );
  });

  it('sends login-customer-id only when configured, digits only', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { resourceNames: [] }));
    await build({
      GOOGLE_ADS_LOGIN_CUSTOMER_ID: '123-456-7890',
    }).listAccessibleCustomerIds('at');
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['login-customer-id']).toBe(
      '1234567890',
    );
  });

  it('pages through campaigns and converts budget micros', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            {
              campaign: {
                id: '111',
                name: 'Search A',
                status: 'ENABLED',
                advertisingChannelType: 'SEARCH',
              },
              campaignBudget: { amountMicros: '15500000' },
            },
          ],
          nextPageToken: 'p2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          results: [
            { campaign: { id: '222', name: 'PMax B', status: 'PAUSED' } },
          ],
        }),
      );

    const campaigns = await build().listCampaigns('at', '1234567890');

    expect(
      campaigns.map((c) => [c.externalCampaignId, c.status, c.budget]),
    ).toEqual([
      ['111', 'ENABLED', 15.5],
      ['222', 'PAUSED', null],
    ]);
    const secondBody = JSON.parse(
      (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string,
    ) as {
      pageToken: string;
    };
    expect(secondBody.pageToken).toBe('p2');
  });

  it('maps daily metrics: micros to money, fractions to percent, omitted zeros', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        results: [
          {
            campaign: { id: '111' },
            segments: { date: '2026-10-01' },
            metrics: {
              costMicros: '12340000',
              clicks: '10',
              impressions: '500',
              conversions: 2.5,
              averageCpm: 24680000,
              ctr: 0.02,
              costPerConversion: 4936000,
              conversionsFromInteractionsRate: 0.25,
            },
          },
          {
            campaign: { id: '111' },
            segments: { date: '2026-10-02' },
            metrics: {},
          },
        ],
      }),
    );

    const rows = await build().getDailyMetrics(
      'at',
      '1234567890',
      ['111'],
      '2026-10-01',
      '2026-10-02',
    );

    expect(rows[0]).toMatchObject({
      spend: 12.34,
      clicks: 10,
      impressions: 500,
      conversions: 2.5,
      cpm: 24.68,
      ctr: 2,
      costPerConversion: 4.936,
      conversionRate: 25,
    });
    expect(rows[1]).toMatchObject({
      spend: 0,
      clicks: 0,
      impressions: 0,
      cpm: null,
    });
    const query = (
      JSON.parse(
        (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
      ) as {
        query: string;
      }
    ).query;
    expect(query).toContain("BETWEEN '2026-10-01' AND '2026-10-02'");
    expect(query).toContain('campaign.id IN (111)');
  });

  it('never puts non-numeric ids into GAQL', async () => {
    await expect(
      build().getDailyMetrics(
        'at',
        '1234567890',
        ['1) OR (1=1'],
        '2026-10-01',
        '2026-10-02',
      ),
    ).resolves.toEqual([]);
    await expect(
      build().listCampaigns('at', '12; DROP'),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('pauses a campaign with an update mask', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { results: [] }));
    await build().setCampaignStatus('at', '1234567890', '111', 'PAUSED');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://googleads.googleapis.com/v25/customers/1234567890/campaigns:mutate',
    );
    expect(JSON.parse(init.body as string)).toEqual({
      operations: [
        {
          update: {
            resourceName: 'customers/1234567890/campaigns/111',
            status: 'PAUSED',
          },
          updateMask: 'status',
        },
      ],
    });
  });

  it('surfaces the Google Ads failure message on 403', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(403, {
        error: {
          code: 403,
          message: 'The caller does not have permission',
          details: [
            {
              errors: [
                {
                  message:
                    'The developer token is only approved for use with test accounts.',
                },
              ],
            },
          ],
        },
      }),
    );
    await expect(build().listAccessibleCustomerIds('at')).rejects.toThrow(
      new ForbiddenException(
        'Google Ads: The developer token is only approved for use with test accounts.',
      ),
    );
  });

  it('maps 401 to Unauthorized and 5xx to Service Unavailable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
    await expect(
      build().listAccessibleCustomerIds('at'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));
    await expect(
      build().listAccessibleCustomerIds('at'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
