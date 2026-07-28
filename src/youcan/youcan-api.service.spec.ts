import {
  BadGatewayException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YouCanApiService } from './youcan-api.service';

describe('YouCanApiService', () => {
  const values: Record<string, unknown> = {
    YOUCAN_ENABLED: true,
    YOUCAN_CLIENT_ID: 'client-id',
    YOUCAN_CLIENT_SECRET: 'client-secret',
    YOUCAN_REDIRECT_URI: 'https://api.example.com/auth/youcan/callback',
    YOUCAN_SCOPES: '*',
    YOUCAN_HTTP_TIMEOUT_MS: 1000,
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
  const service = new YouCanApiService(configService);

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the correct authorization host, path, state, and wildcard scope', () => {
    const url = new URL(service.buildAuthorizationUrl('single-use-state'));

    expect(url.origin).toBe('https://seller-area.youcan.shop');
    expect(url.pathname).toBe('/admin/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/auth/youcan/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('single-use-state');
    expect(url.searchParams.get('scope')).toBe('*');
    expect(url.searchParams.has('scope[]')).toBe(false);
  });

  it('encodes named scopes as one OAuth space-delimited parameter', () => {
    const url = new URL(
      service.buildAuthorizationUrl('single-use-state', [
        'view-store-info',
        'read-orders',
      ]),
    );

    expect(url.searchParams.get('scope')).toBe('view-store-info read-orders');
    expect(url.searchParams.has('scope[]')).toBe(false);
  });

  it('exchanges a code as form data against the API host', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          token_type: 'Bearer',
          expires_in: 3600,
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const result = await service.exchangeAuthorizationCode('one-time-code');
    const [url, request] = fetchMock.mock.calls[0];
    const requestBody = request?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a form-encoded request body');
    }
    const body = new URLSearchParams(requestBody);

    expect(url).toBe('https://api.youcan.shop/oauth/token');
    expect(request?.method).toBe('POST');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('redirect_uri')).toBe(
      'https://api.example.com/auth/youcan/callback',
    );
    expect(body.get('code')).toBe('one-time-code');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('reads and normalizes the connected store from GET /me', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'store-uuid',
          store_id: 'store-uuid',
          slug: 'atlas',
          name: 'Atlas',
          domain: 'atlas.youcan.store',
          email: 'owner@example.com',
          currency: { code: 'MAD', symbol: 'DH' },
          is_active: true,
        }),
        { status: 200 },
      ),
    );

    await expect(service.getStoreDetails('access-token')).resolves.toEqual({
      id: 'store-uuid',
      storeId: 'store-uuid',
      slug: 'atlas',
      name: 'Atlas',
      domain: 'atlas.youcan.store',
      email: 'owner@example.com',
      currencyCode: 'MAD',
      isActive: true,
    });
  });

  it('uploads product images as multipart data without exposing the token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: 'stores/store/products/image.jpeg',
            link: 'https://cdn.youcan.shop/stores/store/products/image.jpeg',
          },
        ]),
        { status: 201, headers: { 'content-type': 'application/json' } },
      ),
    );
    const file = {
      buffer: Buffer.from([0xff, 0xd8, 0xff]),
      originalname: 'phone image.jpg',
      mimetype: 'image/jpeg',
    };

    await expect(
      service.postImages(
        '/media/product/upload-image',
        'private-access-token',
        [file],
      ),
    ).resolves.toHaveLength(1);

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.youcan.shop/media/product/upload-image');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer private-access-token',
    });
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).getAll('images')).toHaveLength(1);
  });

  it.each([
    [401, UnauthorizedException],
    [429, ServiceUnavailableException],
    [502, ServiceUnavailableException],
    [422, BadGatewayException],
  ])('maps token endpoint status %s safely', async (status, expected) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'provider internals' }), {
        status,
      }),
    );

    await expect(
      service.exchangeAuthorizationCode('invalid-code'),
    ).rejects.toBeInstanceOf(expected);
  });
});
