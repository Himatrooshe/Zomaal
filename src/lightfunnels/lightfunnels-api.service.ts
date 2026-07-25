import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const AUTHORIZATION_ENDPOINT = 'https://app.lightfunnels.com/admin/oauth';
const TOKEN_ENDPOINT = 'https://api.lightfunnels.com/oauth/access_token';
const GRAPHQL_ENDPOINT = 'https://services.lightfunnels.com/api/v2';

interface LightfunnelsTokenResponse {
  access_token?: unknown;
}

interface GraphqlError {
  extensions?: { code?: unknown };
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlError[];
}

interface AccountQueryData {
  account?: {
    id?: unknown;
    stores?: unknown;
  };
}

export interface LightfunnelsStoreDetails {
  id: string;
  uid: string | null;
  name: string | null;
  slug: string | null;
  domain: string | null;
}

export interface LightfunnelsAccountDetails {
  accountId: string;
  stores: LightfunnelsStoreDetails[];
}

@Injectable()
export class LightfunnelsApiService {
  constructor(private readonly configService: ConfigService) {}

  assertConfigured(): void {
    if (!this.configService.get<boolean>('LIGHTFUNNELS_ENABLED', false)) {
      throw new ServiceUnavailableException(
        'Lightfunnels integration is not enabled',
      );
    }
    this.required('LIGHTFUNNELS_CLIENT_ID');
    this.required('LIGHTFUNNELS_CLIENT_SECRET');
    this.required('LIGHTFUNNELS_REDIRECT_URI');
  }

  getRequestedScopes(): string[] {
    return normalizeScopes(
      this.configService.get<string>('LIGHTFUNNELS_SCOPES') ?? 'orders,funnels',
    );
  }

  buildAuthorizationUrl(
    state: string,
    scopes = this.getRequestedScopes(),
  ): string {
    this.assertConfigured();
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', this.required('LIGHTFUNNELS_CLIENT_ID'));
    url.searchParams.set(
      'redirect_uri',
      this.required('LIGHTFUNNELS_REDIRECT_URI'),
    );
    url.searchParams.set('scope', scopes.join(','));
    url.searchParams.set('state', state);
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<string> {
    this.assertConfigured();
    const response = await this.fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.required('LIGHTFUNNELS_CLIENT_ID'),
        client_secret: this.required('LIGHTFUNNELS_CLIENT_SECRET'),
        code,
      }),
    });

    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException(
        'Lightfunnels rejected the OAuth token request',
      );
    }
    this.assertSuccessful(response, 'Lightfunnels OAuth token request failed');
    const payload = (await parseJson(response)) as LightfunnelsTokenResponse;
    const accessToken = asNonEmptyString(payload.access_token);
    if (!accessToken) {
      throw new BadGatewayException(
        'Lightfunnels did not return an access token',
      );
    }
    return accessToken;
  }

  async getAccountDetails(
    accessToken: string,
  ): Promise<LightfunnelsAccountDetails> {
    const data = await this.graphql<AccountQueryData>(
      accessToken,
      `query ZomaalLightfunnelsAccount {
        account {
          id
          stores {
            id
            uid
            name
            slug
            defaultDomain
          }
        }
      }`,
    );
    const accountId = asNonEmptyString(data.account?.id);
    if (!accountId) {
      throw new BadGatewayException(
        'Lightfunnels account response did not include an identifier',
      );
    }
    if (!Array.isArray(data.account?.stores)) {
      throw new BadGatewayException(
        'Lightfunnels account response did not include stores',
      );
    }

    return {
      accountId,
      stores: data.account.stores.map((value) => {
        if (!isRecord(value)) {
          throw new BadGatewayException(
            'Lightfunnels returned an invalid store response',
          );
        }
        const id = asNonEmptyString(value.id);
        if (!id) {
          throw new BadGatewayException(
            'Lightfunnels store response did not include an identifier',
          );
        }
        return {
          id,
          uid: asNonEmptyString(value.uid),
          name: asNonEmptyString(value.name),
          slug: asNonEmptyString(value.slug),
          domain: asNonEmptyString(value.defaultDomain),
        };
      }),
    };
  }

  async graphql<T>(
    accessToken: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    this.assertConfigured();
    const response = await this.fetchWithTimeout(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    });

    if (response.status === 401) {
      throw new UnauthorizedException(
        'Lightfunnels access token is no longer authorized',
      );
    }
    if (response.status === 403) {
      throw new ForbiddenException(
        'Lightfunnels denied this operation. Reconnect with the required scopes.',
      );
    }
    this.assertSuccessful(response, 'Lightfunnels API request failed');

    const envelope = (await parseJson(response)) as GraphqlEnvelope<T>;
    if (Array.isArray(envelope.errors) && envelope.errors.length > 0) {
      const codes = envelope.errors
        .map((error) => asNonEmptyString(error.extensions?.code))
        .filter(Boolean);
      if (codes.some((code) => code === 'UNAUTHENTICATED')) {
        throw new UnauthorizedException(
          'Lightfunnels access token is no longer authorized',
        );
      }
      if (codes.some((code) => code === 'FORBIDDEN')) {
        throw new ForbiddenException(
          'Lightfunnels denied this operation. Reconnect with the required scopes.',
        );
      }
      throw new BadGatewayException(
        'Lightfunnels returned a GraphQL operation error',
      );
    }
    if (!envelope.data) {
      throw new BadGatewayException(
        'Lightfunnels returned an invalid GraphQL response',
      );
    }
    return envelope.data;
  }

  isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedException;
  }

  private assertSuccessful(response: Response, message: string): void {
    if (response.ok) {
      return;
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ServiceUnavailableException(
        'Lightfunnels API is temporarily unavailable',
      );
    }
    throw new BadGatewayException(message);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.configService.get<number>('LIGHTFUNNELS_HTTP_TIMEOUT_MS', 15000),
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException('Unable to reach Lightfunnels');
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

function normalizeScopes(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].sort();
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BadGatewayException('Lightfunnels returned a non-JSON response');
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
