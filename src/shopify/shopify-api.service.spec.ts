import { ConfigService } from '@nestjs/config';
import {
  BadGatewayException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GraphqlQueryError,
  HttpMaxRetriesError,
  HttpResponseError,
} from '@shopify/shopify-api';
import { ShopifyApiService } from './shopify-api.service';

describe('ShopifyApiService', () => {
  const values: Record<string, unknown> = {
    SHOPIFY_ENABLED: true,
    SHOPIFY_API_KEY: 'public-client-id',
    SHOPIFY_API_SECRET: 'secret',
    SHOPIFY_APP_URL: 'https://zomaal.test/',
    SHOPIFY_REDIRECT_URI: 'https://zomaal.test/auth/shopify/callback',
    SHOPIFY_API_VERSION: '2026-07',
    SHOPIFY_SCOPES: 'write_orders,read_products',
  };
  const configService = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
  } as unknown as ConfigService;
  const service = new ShopifyApiService(configService);

  it.each([
    ['atlas-market', 'atlas-market.myshopify.com'],
    ['ATLAS-MARKET.MYSHOPIFY.COM', 'atlas-market.myshopify.com'],
    ['https://atlas-market.myshopify.com/', 'atlas-market.myshopify.com'],
  ])('normalizes %s', (input, expected) => {
    expect(service.normalizeShopDomain(input)).toBe(expected);
  });

  it('rejects custom storefront domains', () => {
    expect(() => service.normalizeShopDomain('store.example.com')).toThrow(
      UnauthorizedException,
    );
  });

  it('builds managed-install OAuth URLs without duplicating scopes', () => {
    const authorizationUrl = new URL(
      service.buildAuthorizationUrl(
        'atlas-market.myshopify.com',
        'single-use-state',
      ),
    );

    expect(authorizationUrl.hostname).toBe('atlas-market.myshopify.com');
    expect(authorizationUrl.pathname).toBe('/admin/oauth/authorize');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(
      'public-client-id',
    );
    expect(authorizationUrl.searchParams.get('state')).toBe('single-use-state');
    expect(authorizationUrl.searchParams.has('scope')).toBe(false);
  });

  it('normalizes expected scope configuration', () => {
    expect(service.getExpectedScopes()).toEqual([
      'read_products',
      'write_orders',
    ]);
  });

  describe('GraphQL upstream error mapping', () => {
    it('maps Shopify scope and protected-data denials to 403', async () => {
      const target = serviceWithGraphqlFailure(
        new GraphqlQueryError({
          message: 'Access denied for customers field.',
          response: {},
          body: {
            errors: {
              graphQLErrors: [
                {
                  message: 'Access denied for customers field.',
                  extensions: { code: 'ACCESS_DENIED' },
                },
              ],
            },
          },
        }),
      );

      await expect(
        target.graphqlRequest('atlas.myshopify.com', 'secret', 'query Test {}'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('maps Shopify throttling and exhausted retries to 503', async () => {
      const throttled = serviceWithGraphqlFailure(
        new GraphqlQueryError({
          message: 'Throttled',
          response: {},
          body: {
            errors: {
              graphQLErrors: [
                {
                  message: 'Throttled',
                  extensions: { code: 'THROTTLED' },
                },
              ],
            },
          },
        }),
      );
      const retried = serviceWithGraphqlFailure(
        new HttpMaxRetriesError('Retries exhausted'),
      );

      await expect(
        throttled.graphqlRequest(
          'atlas.myshopify.com',
          'secret',
          'query Test {}',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      await expect(
        retried.graphqlRequest(
          'atlas.myshopify.com',
          'secret',
          'query Test {}',
        ),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('keeps rejected credentials recognizable by the refresh layer', async () => {
      const target = serviceWithGraphqlFailure(
        new HttpResponseError({
          message: 'Unauthorized',
          code: 401,
          statusText: 'Unauthorized',
        }),
      );

      await expect(
        target.graphqlRequest('atlas.myshopify.com', 'secret', 'query Test {}'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('maps unexpected Shopify client failures to a safe 502', async () => {
      const target = serviceWithGraphqlFailure(
        new Error('internal client detail that must not leak'),
      );

      await expect(
        target.graphqlRequest('atlas.myshopify.com', 'secret', 'query Test {}'),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });
  });
});

function serviceWithGraphqlFailure(error: Error): ShopifyApiService {
  const target = new ShopifyApiService({
    get: jest.fn((_key: string, fallback?: unknown) => fallback),
  } as unknown as ConfigService);
  class FailingGraphqlClient {
    request = jest.fn().mockRejectedValue(error);
  }
  (
    target as unknown as {
      apiInstance: {
        clients: {
          Graphql: typeof FailingGraphqlClient;
        };
      };
    }
  ).apiInstance = {
    clients: {
      Graphql: FailingGraphqlClient,
    },
  };
  return target;
}
