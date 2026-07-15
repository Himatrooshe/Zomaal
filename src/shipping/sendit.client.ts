import {
  BadGatewayException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SenditLoginResponse } from './interfaces/sendit-login-response.interface';
import type { SenditCredentials } from './sendit-connection.service';
import { parseProviderJson } from './utils/provider-response';

@Injectable()
export class SenditClient {
  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService) {}

  listDeliveries(
    userId: string,
    credentials: SenditCredentials,
    query: Record<string, string | number | undefined>,
  ) {
    return this.request(userId, credentials, 'GET', '/deliveries', { query });
  }

  createDelivery(
    userId: string,
    credentials: SenditCredentials,
    payload: unknown,
  ) {
    return this.request(userId, credentials, 'POST', '/deliveries', {
      body: payload,
    });
  }

  getDelivery(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'GET',
      `/deliveries/${encodeURIComponent(code)}`,
    );
  }

  updateDelivery(
    userId: string,
    credentials: SenditCredentials,
    code: string,
    payload: unknown,
  ) {
    return this.request(
      userId,
      credentials,
      'PUT',
      `/deliveries/${encodeURIComponent(code)}`,
      {
        body: payload,
      },
    );
  }

  deleteDelivery(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'DELETE',
      `/deliveries/${encodeURIComponent(code)}`,
    );
  }

  printDeliveryLabels(
    userId: string,
    credentials: SenditCredentials,
    payload: unknown,
  ) {
    return this.request(userId, credentials, 'POST', '/deliveries/getlabels', {
      body: payload,
    });
  }

  listDeliveryStatuses(userId: string, credentials: SenditCredentials) {
    return this.request(userId, credentials, 'GET', '/all-status-deliveries');
  }

  listDistricts(
    userId: string,
    credentials: SenditCredentials,
    query: Record<string, string | number | undefined>,
  ) {
    return this.request(userId, credentials, 'GET', '/districts', { query });
  }

  listPickupCities(userId: string, credentials: SenditCredentials) {
    return this.request(userId, credentials, 'GET', '/districts/pickup-cities');
  }

  getDistrict(userId: string, credentials: SenditCredentials, id: number) {
    return this.request(userId, credentials, 'GET', `/districts/${id}`);
  }

  listPickups(
    userId: string,
    credentials: SenditCredentials,
    query: Record<string, string | number | undefined>,
  ) {
    return this.request(userId, credentials, 'GET', '/pickups', { query });
  }

  createPickup(
    userId: string,
    credentials: SenditCredentials,
    payload: unknown,
  ) {
    return this.request(userId, credentials, 'POST', '/pickups', {
      body: payload,
    });
  }

  getPickup(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'GET',
      `/pickups/${encodeURIComponent(code)}`,
    );
  }

  updatePickup(
    userId: string,
    credentials: SenditCredentials,
    code: string,
    payload: unknown,
  ) {
    return this.request(
      userId,
      credentials,
      'PUT',
      `/pickups/${encodeURIComponent(code)}`,
      {
        body: payload,
      },
    );
  }

  deletePickup(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'DELETE',
      `/pickups/${encodeURIComponent(code)}`,
    );
  }

  listReturns(
    userId: string,
    credentials: SenditCredentials,
    query: Record<string, string | number | undefined>,
  ) {
    return this.request(userId, credentials, 'GET', '/returns', { query });
  }

  createReturn(
    userId: string,
    credentials: SenditCredentials,
    payload: unknown,
  ) {
    return this.request(userId, credentials, 'POST', '/returns', {
      body: payload,
    });
  }

  getReturn(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'GET',
      `/returns/${encodeURIComponent(code)}`,
    );
  }

  updateReturn(
    userId: string,
    credentials: SenditCredentials,
    code: string,
    payload: unknown,
  ) {
    return this.request(
      userId,
      credentials,
      'PUT',
      `/returns/${encodeURIComponent(code)}`,
      {
        body: payload,
      },
    );
  }

  deleteReturn(userId: string, credentials: SenditCredentials, code: string) {
    return this.request(
      userId,
      credentials,
      'DELETE',
      `/returns/${encodeURIComponent(code)}`,
    );
  }

  async getAccessToken(
    userId: string,
    credentials: SenditCredentials,
  ): Promise<string> {
    const cached = this.tokens.get(userId);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }

    const login = await this.authenticate(credentials);
    const token = login.data?.token;

    if (!token) {
      throw new BadGatewayException('Sendit did not return an access token');
    }

    this.cacheLogin(userId, login);
    return token;
  }

  async authenticate(
    credentials: SenditCredentials,
  ): Promise<SenditLoginResponse> {
    const response = await fetch(this.buildUrl('/login'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        public_key: credentials.publicKey,
        secret_key: credentials.secretKey,
      }),
    });

    if (response.status === 401) {
      throw new UnauthorizedException('Sendit credentials were rejected');
    }

    if (!response.ok) {
      throw new BadGatewayException(
        `Sendit login failed with status ${response.status}`,
      );
    }

    const body = await parseProviderJson<SenditLoginResponse>(
      response,
      'Sendit',
    );
    const token = body.data?.token;

    if (!body.success || !token) {
      throw new BadGatewayException(body.message || 'Sendit login failed');
    }

    return body;
  }

  cacheLogin(userId: string, login: SenditLoginResponse) {
    const token = login.data?.token;
    if (token)
      this.tokens.set(userId, {
        token,
        expiresAt: Date.now() + this.getTokenTtlMs(),
      });
  }

  clearUserToken(userId: string) {
    this.tokens.delete(userId);
  }

  private async request<T = unknown>(
    userId: string,
    credentials: SenditCredentials,
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const token = await this.getAccessToken(userId, credentials);
    const response = await fetch(this.buildUrl(path, options.query), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (response.status === 401 || response.status === 403) {
      this.clearUserToken(userId);
      throw new UnauthorizedException('Sendit request was not authorized');
    }

    const body = await parseProviderJson<T>(response, 'Sendit');

    if (!response.ok) {
      throw new BadGatewayException({
        message: `Sendit request failed with status ${response.status}`,
        sendit: body,
      });
    }

    return body;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | undefined>,
  ): string {
    const baseUrl = this.configService.get<string>(
      'SENDIT_API_BASE_URL',
      'https://app.sendit.ma/api/v1',
    );
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    const url = new URL(`${normalizedBaseUrl}/${normalizedPath}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private getTokenTtlMs(): number {
    const ttlSeconds = this.configService.get<number>(
      'SENDIT_TOKEN_TTL_SECONDS',
      3300,
    );

    return ttlSeconds * 1000;
  }
}
