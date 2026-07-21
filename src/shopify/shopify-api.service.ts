import '@shopify/shopify-api/adapters/node';
import {
  ApiVersion,
  GraphqlQueryError,
  HttpMaxRetriesError,
  HttpRequestError,
  HttpResponseError,
  HttpThrottlingError,
  LogSeverity,
  Session,
  shopifyApi,
} from '@shopify/shopify-api';
import {
  BadGatewayException,
  ForbiddenException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

interface ShopifyAccessTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

export interface ShopifyTokenSet {
  accessToken: string;
  refreshToken: string;
  grantedScopes: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

@Injectable()
export class ShopifyApiService {
  private apiInstance?: ReturnType<typeof shopifyApi>;

  constructor(private readonly configService: ConfigService) {}

  assertConfigured(): void {
    if (!this.configService.get<boolean>('SHOPIFY_ENABLED', false)) {
      throw new ServiceUnavailableException(
        'Shopify integration is not enabled',
      );
    }
    this.getApi();
  }

  normalizeShopDomain(input: string): string {
    let value = input.trim().toLowerCase();
    if (value.startsWith('http://') || value.startsWith('https://')) {
      try {
        value = new URL(value).hostname;
      } catch {
        throw new UnauthorizedException('Invalid Shopify shop domain');
      }
    }
    value = value.replace(/\/+$/, '');
    if (!value.includes('.')) {
      value = `${value}.myshopify.com`;
    }
    if (
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value) ||
      !this.getApi().utils.sanitizeShop(value, true)
    ) {
      throw new UnauthorizedException('Invalid Shopify shop domain');
    }
    return value;
  }

  buildAuthorizationUrl(shopDomain: string, state: string): string {
    this.assertConfigured();
    const query = new URLSearchParams({
      client_id: this.required('SHOPIFY_API_KEY'),
      redirect_uri: this.required('SHOPIFY_REDIRECT_URI'),
      state,
    });

    // Scopes are intentionally omitted. Shopify managed installation reads
    // the required scope set from the deployed shopify.app.toml.
    return `https://${shopDomain}/admin/oauth/authorize?${query.toString()}`;
  }

  async validateOAuthQuery(query: Record<string, string>): Promise<void> {
    try {
      const valid = await this.getApi().utils.validateHmac(query);
      if (!valid) {
        throw new UnauthorizedException('Invalid Shopify OAuth signature');
      }
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException(
        'Invalid or expired Shopify OAuth callback',
      );
    }
  }

  async exchangeAuthorizationCode(
    shopDomain: string,
    code: string,
  ): Promise<ShopifyTokenSet> {
    this.assertConfigured();
    const response = await this.fetchWithTimeout(
      `https://${shopDomain}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: this.required('SHOPIFY_API_KEY'),
          client_secret: this.required('SHOPIFY_API_SECRET'),
          code,
          expiring: 1,
        }),
      },
    );

    if (!response.ok) {
      throw new UnauthorizedException(
        'Shopify rejected the authorization code exchange',
      );
    }

    const payload = (await response.json()) as ShopifyAccessTokenResponse;
    return this.toExpiringTokenSet(payload);
  }

  async refreshAccessToken(
    shopDomain: string,
    refreshToken: string,
  ): Promise<ShopifyTokenSet> {
    try {
      const result = await this.getApi().auth.refreshToken({
        shop: shopDomain,
        refreshToken,
      });
      return this.toExpiringTokenSet({
        access_token: result.session.accessToken ?? '',
        refresh_token: result.session.refreshToken,
        scope: result.session.scope ?? '',
        expires_in: secondsUntil(result.session.expires),
        refresh_token_expires_in: secondsUntil(
          result.session.refreshTokenExpires,
        ),
      });
    } catch (error) {
      if (shopifyHttpStatus(error) === 401) {
        throw new UnauthorizedException(
          'Shopify refresh token is no longer valid',
        );
      }
      throw new ServiceUnavailableException(
        'Unable to refresh Shopify access token',
      );
    }
  }

  async graphqlRequest<T>(
    shopDomain: string,
    accessToken: string,
    operation: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const session = new Session({
      id: `offline_${shopDomain}`,
      shop: shopDomain,
      state: '',
      isOnline: false,
      accessToken,
    });
    const GraphqlClient = this.getApi().clients.Graphql;
    const client = new GraphqlClient({ session });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.configService.get<number>('SHOPIFY_HTTP_TIMEOUT_MS', 15000),
    );

    try {
      const response = await client.request<T>(operation, {
        variables,
        retries: 2,
        signal: controller.signal,
      });
      if (!response.data) {
        throw new BadGatewayException(
          'Shopify returned an empty GraphQL response',
        );
      }
      return response.data;
    } catch (error) {
      throw this.mapGraphqlRequestError(error);
    } finally {
      clearTimeout(timeout);
    }
  }

  async validateWebhook(
    request: Request,
    rawBody: string,
  ): Promise<{
    topic: string;
    domain: string;
    webhookId: string;
  }> {
    const result = await this.getApi().webhooks.validate({
      rawRequest: request,
      rawBody,
    });
    if (!result.valid) {
      throw new UnauthorizedException('Invalid Shopify webhook signature');
    }
    return {
      topic: result.topic,
      domain: this.normalizeShopDomain(result.domain),
      webhookId: result.webhookId,
    };
  }

  getExpectedScopes(): string[] {
    const configured =
      this.configService.get<string>('SHOPIFY_SCOPES') ??
      this.configService.get<string>('SCOPES') ??
      '';
    return configured
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
      .sort();
  }

  isUnauthorizedError(error: unknown): boolean {
    return (
      error instanceof UnauthorizedException || shopifyHttpStatus(error) === 401
    );
  }

  private mapGraphqlRequestError(error: unknown): Error {
    if (error instanceof HttpException) {
      return error;
    }

    if (error instanceof GraphqlQueryError) {
      const codes = shopifyGraphqlErrorCodes(error);
      const accessDenied =
        codes.includes('ACCESS_DENIED') ||
        /access denied|not authorized|permission/i.test(error.message);
      if (accessDenied) {
        return new ForbiddenException(
          'Shopify denied access to this data. Reconnect with the required scopes and protected customer data permissions.',
        );
      }
      if (codes.includes('THROTTLED')) {
        return new ServiceUnavailableException(
          'Shopify Admin API is temporarily throttling requests',
        );
      }
      return new BadGatewayException('Shopify rejected the GraphQL operation');
    }

    const status = shopifyHttpStatus(error);
    if (status === 401) {
      return new UnauthorizedException(
        'Shopify access token is no longer valid',
      );
    }
    if (status === 403) {
      return new ForbiddenException(
        'Shopify denied access to the requested store data',
      );
    }
    if (
      status === 429 ||
      (typeof status === 'number' && status >= 500) ||
      error instanceof HttpRequestError ||
      error instanceof HttpMaxRetriesError ||
      error instanceof HttpThrottlingError
    ) {
      return new ServiceUnavailableException(
        'Shopify Admin API is temporarily unavailable',
      );
    }
    if (isAbortError(error)) {
      return new ServiceUnavailableException(
        'Shopify Admin API request timed out',
      );
    }

    return new BadGatewayException('Shopify Admin API request failed');
  }

  private getApi(): ReturnType<typeof shopifyApi> {
    if (this.apiInstance) {
      return this.apiInstance;
    }

    const appUrl = new URL(this.required('SHOPIFY_APP_URL'));
    this.apiInstance = shopifyApi({
      apiKey: this.required('SHOPIFY_API_KEY'),
      apiSecretKey: this.required('SHOPIFY_API_SECRET'),
      apiVersion: this.required('SHOPIFY_API_VERSION') as ApiVersion,
      hostName: appUrl.host,
      hostScheme: appUrl.protocol === 'http:' ? 'http' : 'https',
      isEmbeddedApp: false,
      scopes: undefined,
      userAgentPrefix: 'Zomaal',
      logger: {
        level:
          this.configService.get<string>('NODE_ENV') === 'production'
            ? LogSeverity.Warning
            : LogSeverity.Info,
        httpRequests: false,
      },
    });
    return this.apiInstance;
  }

  private toExpiringTokenSet(
    payload: ShopifyAccessTokenResponse,
  ): ShopifyTokenSet {
    if (
      !payload.access_token ||
      !payload.refresh_token ||
      !payload.expires_in ||
      !payload.refresh_token_expires_in
    ) {
      throw new BadGatewayException(
        'Shopify did not return the required expiring offline token fields',
      );
    }

    const now = Date.now();
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      grantedScopes: normalizeScopeString(payload.scope),
      accessTokenExpiresAt: new Date(now + payload.expires_in * 1000),
      refreshTokenExpiresAt: new Date(
        now + payload.refresh_token_expires_in * 1000,
      ),
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.configService.get<number>('SHOPIFY_HTTP_TIMEOUT_MS', 15000),
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new BadGatewayException('Unable to reach Shopify');
    } finally {
      clearTimeout(timeout);
    }
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }
}

function secondsUntil(value: Date | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return Math.max(1, Math.ceil((value.getTime() - Date.now()) / 1000));
}

function normalizeScopeString(value: string): string {
  return [
    ...new Set(
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ]
    .sort()
    .join(',');
}

function shopifyHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof HttpResponseError)) {
    return undefined;
  }
  const response: unknown = error.response;
  if (!response || typeof response !== 'object' || !('code' in response)) {
    return undefined;
  }
  const code = (response as Record<string, unknown>).code;
  return typeof code === 'number' ? code : undefined;
}

function shopifyGraphqlErrorCodes(error: GraphqlQueryError): string[] {
  const body: unknown = error.body;
  const errors: unknown = isRecord(body) ? body.errors : undefined;
  if (!isRecord(errors) || !Array.isArray(errors.graphQLErrors)) {
    return [];
  }

  return errors.graphQLErrors.flatMap((graphQLError: unknown) => {
    if (!isRecord(graphQLError) || !isRecord(graphQLError.extensions)) {
      return [];
    }
    const code = graphQLError.extensions.code;
    return typeof code === 'string' ? [code.toUpperCase()] : [];
  });
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
