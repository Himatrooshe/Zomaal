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

  async checkConnection() {
    await this.getProducts();

    return {
      connected: true,
      provider: 'quicklivraison.ma',
      message: 'QuickLivraison API key is configured and accepted.',
    };
  }

  createDelivery(payload: unknown) {
    return this.request('POST', '/deliveries/store', {
      body: this.withApiKey(payload),
    });
  }

  createBulkDeliveries(parcels: unknown[]) {
    return this.request('POST', '/deliveries/bulk-store', {
      body: this.withApiKey({ parcels }),
    });
  }

  listDeliveries() {
    return this.request('GET', '/getParcelDetailsApi', {
      query: this.apiKeyQuery(),
    });
  }

  getProducts() {
    return this.request('GET', '/getProductIDs', {
      query: this.apiKeyQuery(),
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
    const response = await fetch(this.buildUrl(path, options.query), {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const body = await parseProviderJson<T>(response, 'QuickLivraison');

    if (!response.ok) {
      throw new BadGatewayException({
        message: `QuickLivraison request failed with status ${response.status}`,
        quicklivraison: body,
      });
    }

    return body;
  }

  private withApiKey(payload: unknown) {
    return {
      ...(payload && typeof payload === 'object' ? payload : {}),
      api_key: this.getApiKey(),
    };
  }

  private apiKeyQuery() {
    return {
      api_key: this.getApiKey(),
    };
  }

  private getApiKey(): string {
    const apiKey = this.configService.get<string>('QUICKLIVRAISON_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'QuickLivraison API key is not configured',
      );
    }

    return apiKey;
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
