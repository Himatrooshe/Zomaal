import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SenditConnectionStatus } from './interfaces/sendit-connection.interface';
import type { SenditLoginResponse } from './interfaces/sendit-login-response.interface';
import { parseProviderJson } from './utils/provider-response';

@Injectable()
export class SenditClient {
  private token: string | null = null;
  private accountName: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  async checkConnection(): Promise<SenditConnectionStatus> {
    const login = await this.login();

    return {
      connected: true,
      provider: 'sendit.ma',
      accountName: login.data?.name ?? null,
      message: login.message,
    };
  }

  listDeliveries(query: Record<string, string | number | undefined>) {
    return this.request('GET', '/deliveries', { query });
  }

  createDelivery(payload: unknown) {
    return this.request('POST', '/deliveries', { body: payload });
  }

  getDelivery(code: string) {
    return this.request('GET', `/deliveries/${encodeURIComponent(code)}`);
  }

  updateDelivery(code: string, payload: unknown) {
    return this.request('PUT', `/deliveries/${encodeURIComponent(code)}`, {
      body: payload,
    });
  }

  deleteDelivery(code: string) {
    return this.request('DELETE', `/deliveries/${encodeURIComponent(code)}`);
  }

  printDeliveryLabels(payload: unknown) {
    return this.request('POST', '/deliveries/getlabels', { body: payload });
  }

  listDeliveryStatuses() {
    return this.request('GET', '/all-status-deliveries');
  }

  listDistricts(query: Record<string, string | number | undefined>) {
    return this.request('GET', '/districts', { query });
  }

  listPickupCities() {
    return this.request('GET', '/districts/pickup-cities');
  }

  getDistrict(id: number) {
    return this.request('GET', `/districts/${id}`);
  }

  listPickups(query: Record<string, string | number | undefined>) {
    return this.request('GET', '/pickups', { query });
  }

  createPickup(payload: unknown) {
    return this.request('POST', '/pickups', { body: payload });
  }

  getPickup(code: string) {
    return this.request('GET', `/pickups/${encodeURIComponent(code)}`);
  }

  updatePickup(code: string, payload: unknown) {
    return this.request('PUT', `/pickups/${encodeURIComponent(code)}`, {
      body: payload,
    });
  }

  deletePickup(code: string) {
    return this.request('DELETE', `/pickups/${encodeURIComponent(code)}`);
  }

  listReturns(query: Record<string, string | number | undefined>) {
    return this.request('GET', '/returns', { query });
  }

  createReturn(payload: unknown) {
    return this.request('POST', '/returns', { body: payload });
  }

  getReturn(code: string) {
    return this.request('GET', `/returns/${encodeURIComponent(code)}`);
  }

  updateReturn(code: string, payload: unknown) {
    return this.request('PUT', `/returns/${encodeURIComponent(code)}`, {
      body: payload,
    });
  }

  deleteReturn(code: string) {
    return this.request('DELETE', `/returns/${encodeURIComponent(code)}`);
  }

  async getAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const login = await this.login();
    const token = login.data?.token;

    if (!token) {
      throw new BadGatewayException('Sendit did not return an access token');
    }

    return token;
  }

  private async login(): Promise<SenditLoginResponse> {
    const publicKey = this.configService.get<string>('SENDIT_PUBLIC_KEY');
    const secretKey = this.configService.get<string>('SENDIT_SECRET_KEY');

    if (!publicKey || !secretKey) {
      throw new ServiceUnavailableException(
        'Sendit credentials are not configured',
      );
    }

    const response = await fetch(this.buildUrl('/login'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        public_key: publicKey,
        secret_key: secretKey,
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

    this.token = token;
    this.accountName = body.data?.name ?? null;
    this.tokenExpiresAt = Date.now() + this.getTokenTtlMs();

    return {
      ...body,
      data: {
        ...body.data,
        name: this.accountName ?? undefined,
      },
    };
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | undefined>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    const token = await this.getAccessToken();
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
      this.clearToken();
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

  private clearToken() {
    this.token = null;
    this.accountName = null;
    this.tokenExpiresAt = 0;
  }
}
