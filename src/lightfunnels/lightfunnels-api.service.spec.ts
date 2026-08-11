import {
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LightfunnelsApiService } from './lightfunnels-api.service';

describe('LightfunnelsApiService', () => {
  const values: Record<string, unknown> = {
    LIGHTFUNNELS_ENABLED: true,
    LIGHTFUNNELS_CLIENT_ID: 'client-id',
    LIGHTFUNNELS_CLIENT_SECRET: 'client-secret',
    LIGHTFUNNELS_REDIRECT_URI:
      'http://localhost:3001/auth/lightfunnels/callback',
    LIGHTFUNNELS_SCOPES: 'orders,funnels,products,customers',
    LIGHTFUNNELS_HTTP_TIMEOUT_MS: 1000,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
  const service = new LightfunnelsApiService(configService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds the documented consent URL with comma-separated scopes', () => {
    const url = new URL(service.buildAuthorizationUrl('single-use-state'));

    expect(url.origin).toBe('https://app.lightfunnels.com');
    expect(url.pathname).toBe('/admin/oauth');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3001/auth/lightfunnels/callback',
    );
    expect(url.searchParams.get('scope')).toBe(
      'customers,funnels,orders,products',
    );
    expect(url.searchParams.get('state')).toBe('single-use-state');
  });

  it('exchanges the one-time code using a JSON request body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'permanent-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      service.exchangeAuthorizationCode('one-time-code'),
    ).resolves.toBe('permanent-token');

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.lightfunnels.com/oauth/access_token');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual(
      expect.objectContaining({ 'Content-Type': 'application/json' }),
    );
    expect(JSON.parse(request?.body as string)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'one-time-code',
    });
  });

  it('reads the account and stores through the GraphQL endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            account: {
              id: 'account-id',
              stores: [
                {
                  id: 'store-id',
                  uid: 'store-uid',
                  name: 'Atlas',
                  slug: 'atlas',
                  defaultDomain: 'atlas.lightfunnels.com',
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(service.getAccountDetails('access-token')).resolves.toEqual({
      accountId: 'account-id',
      stores: [
        {
          id: 'store-id',
          uid: 'store-uid',
          name: 'Atlas',
          slug: 'atlas',
          domain: 'atlas.lightfunnels.com',
        },
      ],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://services.lightfunnels.com/api/v2',
    );
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer access-token' }),
    );
  });

  it.each([
    [401, UnauthorizedException],
    [429, ServiceUnavailableException],
    [502, ServiceUnavailableException],
    [422, BadGatewayException],
  ])('maps token endpoint status %s safely', async (status, expected) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'provider detail' }), { status }),
      );

    await expect(
      service.exchangeAuthorizationCode('invalid-code'),
    ).rejects.toBeInstanceOf(expected);
  });
});
