import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseProviderJson } from './utils/provider-response';

@Injectable()
export class QuickLivraisonClient {
  constructor(private readonly configService: ConfigService) {}

  async checkConnection(apiKey: string) {
    await this.getProducts(apiKey);

    return {
      connected: true,
      provider: 'quicklivraison.ma',
      message: 'QuickLivraison API key is configured and accepted.',
    };
  }

  createDelivery(apiKey: string, payload: unknown) {
    return this.request('POST', '/deliveries/store', {
      body: this.withApiKey(payload, apiKey),
    });
  }

  createBulkDeliveries(apiKey: string, parcels: unknown[]) {
    return this.request('POST', '/deliveries/bulk-store', {
      body: this.withApiKey({ parcels }, apiKey),
    });
  }

  listDeliveries(apiKey: string) {
    return this.request('GET', '/getParcelDetailsApi', {
      query: this.apiKeyQuery(apiKey),
    });
  }

  getProducts(apiKey: string) {
    return this.request('GET', '/getProductIDs', {
      query: this.apiKeyQuery(apiKey),
    });
  }

  getCities() {
    return this.request('GET', '/getCityIDs');
  }

  getCitiesWithFeesAndDelays() {
    return this.request('GET', '/cities/frais-delay');
  }

  trackDelivery(trackingNumber: string) {
    return this.request(
      'GET',
      `/getParcelDetails/${encodeURIComponent(trackingNumber)}`,
    );
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number | boolean | undefined>;
      body?: unknown;
    } = {},
  ): Promise<T> {
    let response: Response;

    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ServiceUnavailableException(
        'QuickLivraison is currently unreachable',
      );
    }

    const body = await parseProviderJson<T>(response, 'QuickLivraison');

    if (!response.ok || this.isProviderError(body)) {
      const providerStatus = this.providerErrorCode(body) ?? response.status;
      throw new BadGatewayException({
        message: `QuickLivraison request failed with status ${providerStatus}`,
        quicklivraison: body,
      });
    }

    return body;
  }

  private withApiKey(payload: unknown, apiKey: string) {
    return {
      ...(payload && typeof payload === 'object' ? payload : {}),
      api_key: apiKey,
    };
  }

  private apiKeyQuery(apiKey: string) {
    return {
      api_key: apiKey,
    };
  }

  private isProviderError(body: unknown): boolean {
    return (
      !!body &&
      typeof body === 'object' &&
      ('error' in body || 'error_code' in body)
    );
  }

  private providerErrorCode(body: unknown): string | number | undefined {
    if (!body || typeof body !== 'object' || !('error_code' in body)) {
      return undefined;
    }

    const errorCode = body.error_code;
    return typeof errorCode === 'string' || typeof errorCode === 'number'
      ? errorCode
      : undefined;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const baseUrl = this.configService.get<string>(
      'QUICKLIVRAISON_API_BASE_URL',
      'https://clients.quicklivraison.ma/api',
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
