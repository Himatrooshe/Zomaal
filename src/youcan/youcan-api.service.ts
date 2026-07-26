import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const AUTHORIZATION_ENDPOINT =
  'https://seller-area.youcan.shop/admin/oauth/authorize';
const TOKEN_ENDPOINT = 'https://api.youcan.shop/oauth/token';
const STORE_DETAILS_ENDPOINT = 'https://api.youcan.shop/me';
const API_ORIGIN = 'https://api.youcan.shop';

interface YouCanTokenResponse {
  token_type?: unknown;
  expires_in?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
}

export interface YouCanTokenSet {
  tokenType: string;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export interface YouCanStoreDetails {
  id: string;
  storeId: string;
  slug: string | null;
  name: string | null;
  domain: string | null;
  email: string | null;
  currencyCode: string | null;
  isActive: boolean | null;
}

@Injectable()
export class YouCanApiService {
  constructor(private readonly configService: ConfigService) {}

  assertConfigured(): void {
    if (!this.configService.get<boolean>('YOUCAN_ENABLED', false)) {
      throw new ServiceUnavailableException(
        'YouCan integration is not enabled',
      );
    }
    this.required('YOUCAN_CLIENT_ID');
    this.required('YOUCAN_CLIENT_SECRET');
    this.required('YOUCAN_REDIRECT_URI');
  }

  getRequestedScopes(): string[] {
    const configured = this.configService.get<string>('YOUCAN_SCOPES') ?? '*';
    return normalizeScopes(configured);
  }

  buildAuthorizationUrl(state: string, scopes = this.getRequestedScopes()) {
    this.assertConfigured();
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', this.required('YOUCAN_CLIENT_ID'));
    url.searchParams.set('redirect_uri', this.required('YOUCAN_REDIRECT_URI'));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    url.searchParams.set('scope', scopes.join(' '));
    return url.toString();
  }

  async exchangeAuthorizationCode(code: string): Promise<YouCanTokenSet> {
    this.assertConfigured();
    return this.requestToken({
      grant_type: 'authorization_code',
      client_id: this.required('YOUCAN_CLIENT_ID'),
      client_secret: this.required('YOUCAN_CLIENT_SECRET'),
      redirect_uri: this.required('YOUCAN_REDIRECT_URI'),
      code,
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<YouCanTokenSet> {
    this.assertConfigured();
    return this.requestToken(
      {
        grant_type: 'refresh_token',
        client_id: this.required('YOUCAN_CLIENT_ID'),
        client_secret: this.required('YOUCAN_CLIENT_SECRET'),
        refresh_token: refreshToken,
      },
      refreshToken,
    );
  }

  async getStoreDetails(accessToken: string): Promise<YouCanStoreDetails> {
    const payload = await this.getJson<unknown>(
      STORE_DETAILS_ENDPOINT,
      accessToken,
    );
    if (!isRecord(payload)) {
      throw new BadGatewayException(
        'YouCan returned an invalid store details response',
      );
    }

    const id =
      asNonEmptyString(payload.store_id) || asNonEmptyString(payload.id);
    if (!id) {
      throw new BadGatewayException(
        'YouCan store details did not include a store identifier',
      );
    }
    const currency = isRecord(payload.currency) ? payload.currency : {};

    return {
      id: asNonEmptyString(payload.id) || id,
      storeId: id,
      slug: asNonEmptyString(payload.slug),
      name: asNonEmptyString(payload.name),
      domain: asNonEmptyString(payload.domain),
      email: asNonEmptyString(payload.email),
      currencyCode: asNonEmptyString(currency.code),
      isActive:
        typeof payload.is_active === 'boolean' ? payload.is_active : null,
    };
  }

  async getJson<T>(
    pathOrUrl: string,
    accessToken: string,
    query?: Record<string, string | number | null | undefined>,
  ): Promise<T> {
    this.assertConfigured();
    const url = new URL(pathOrUrl, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new ServiceUnavailableException('Invalid YouCan API endpoint');
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== null && value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await this.fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (response.status === 401) {
      throw new UnauthorizedException(
        'YouCan access token is no longer authorized',
      );
    }
    if (response.status === 403) {
      throw new ForbiddenException(
        'YouCan denied this operation. Reconnect the store with the required scopes.',
      );
    }
    this.assertSuccessful(response, 'YouCan API request failed');
    return (await parseJson(response)) as T;
  }

  async postJson<T>(
    pathOrUrl: string,
    accessToken: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    this.assertConfigured();
    const url = new URL(pathOrUrl, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new ServiceUnavailableException('Invalid YouCan API endpoint');
    }

    const response = await this.fetchWithTimeout(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (response.status === 401) {
      throw new UnauthorizedException(
        'YouCan access token is no longer authorized',
      );
    }
    if (response.status === 403) {
      throw new ForbiddenException(
        'YouCan denied this operation. Reconnect the store with the required scopes.',
      );
    }
    this.assertSuccessful(response, 'YouCan API request failed');
    return (await parseJson(response)) as T;
  }

  isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedException;
  }

  private async requestToken(
    parameters: Record<string, string>,
    currentRefreshToken?: string,
  ): Promise<YouCanTokenSet> {
    const response = await this.fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(parameters).toString(),
    });

    if (response.status === 400 || response.status === 401) {
      throw new UnauthorizedException(
        'YouCan rejected the OAuth token request',
      );
    }
    this.assertSuccessful(response, 'YouCan OAuth token request failed');

    const payload = (await parseJson(response)) as YouCanTokenResponse;
    const accessToken = asNonEmptyString(payload.access_token);
    const refreshToken =
      asNonEmptyString(payload.refresh_token) || currentRefreshToken || null;
    const expiresIn = positiveNumber(payload.expires_in);
    const tokenType = asNonEmptyString(payload.token_type) || 'Bearer';

    if (!accessToken || !refreshToken || !expiresIn) {
      throw new BadGatewayException(
        'YouCan did not return the required OAuth token fields',
      );
    }
    if (tokenType.toLowerCase() !== 'bearer') {
      throw new BadGatewayException(
        'YouCan returned an unsupported OAuth token type',
      );
    }

    return {
      tokenType: 'Bearer',
      accessToken,
      refreshToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  private assertSuccessful(response: Response, message: string): void {
    if (response.ok) {
      return;
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ServiceUnavailableException(
        'YouCan API is temporarily unavailable',
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
      this.configService.get<number>('YOUCAN_HTTP_TIMEOUT_MS', 15000),
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException('Unable to reach YouCan');
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
    throw new BadGatewayException('YouCan returned a non-JSON response');
  }
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
