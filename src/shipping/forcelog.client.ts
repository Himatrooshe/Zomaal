import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseProviderJson } from './utils/provider-response';

@Injectable()
export class ForceLogClient {
  constructor(private readonly configService: ConfigService) {}

  checkConnection() {
    return this.request('GET', '/health', { useHealthBaseUrl: true });
  }

  addParcel(payload: unknown) {
    return this.request('POST', '/Parcels/AddParcel', { body: payload });
  }

  getParcel(code: string) {
    return this.request('GET', '/Parcels/GetParcel', {
      query: { Code: code },
    });
  }

  relaunchParcel(payload: unknown) {
    return this.request('POST', '/Parcels/Relaunch', { body: payload });
  }

  relaunchParcelZone(payload: unknown) {
    return this.request('POST', '/Parcels/RelaunchZone', { body: payload });
  }

  deleteParcel(code: string) {
    return this.request('POST', '/Parcels/DeleteParcel', {
      body: { CODE: code },
    });
  }

  async getParcelSticker(parcelCode: string) {
    const response = await fetch(
      this.buildUrl('/PDF/ParcelSticker', {
        parcelCode,
      }),
      {
        method: 'GET',
        headers: this.getHeaders(),
      },
    );

    if (!response.ok) {
      throw new BadGatewayException(
        `ForceLog sticker request failed with status ${response.status}`,
      );
    }

    const contentType =
      response.headers.get('content-type') ?? 'application/pdf';
    const data = Buffer.from(await response.arrayBuffer()).toString('base64');

    return {
      contentType,
      data,
      encoding: 'base64',
    };
  }

  createPickup(payload: unknown) {
    return this.request('POST', '/Pickups/CreateRequest', { body: payload });
  }

  getCities() {
    return this.request('GET', '/Cities');
  }

  getStock() {
    return this.request('GET', '/Stock');
  }

  addProduct(payload: unknown) {
    return this.request('POST', '/Stock/AddProduct', { body: payload });
  }

  getReturnEligibleParcels() {
    return this.request('POST', '/Return/GetParcels');
  }

  requestReturn(payload: unknown) {
    return this.request('POST', '/Return/Request', { body: payload });
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
      useHealthBaseUrl?: boolean;
    } = {},
  ): Promise<T> {
    const response = await fetch(
      this.buildUrl(path, options.query, options.useHealthBaseUrl),
      {
        method,
        headers: this.getHeaders(),
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
    );

    const body = await parseProviderJson<T>(response, 'ForceLog');

    if (!response.ok) {
      throw new BadGatewayException({
        message: `ForceLog request failed with status ${response.status}`,
        forcelog: body,
      });
    }

    return body;
  }

  private getHeaders() {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': this.getApiKey(),
    };
  }

  private getApiKey(): string {
    const apiKey = this.configService.get<string>('FORCELOG_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'ForceLog API key is not configured',
      );
    }

    return apiKey;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    useHealthBaseUrl = false,
  ): string {
    const baseUrl = useHealthBaseUrl
      ? this.configService.get<string>(
          'FORCELOG_HEALTH_BASE_URL',
          'https://api.forcelog.ma',
        )
      : this.configService.get<string>(
          'FORCELOG_API_BASE_URL',
          'https://api.forcelog.ma/customer',
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
}
