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

  checkConnection(apiKey: string) {
    return this.getCities(apiKey);
  }

  addParcel(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Parcels/AddParcel', {
      body: payload,
    });
  }

  getParcel(apiKey: string, code: string) {
    return this.request(apiKey, 'GET', '/Parcels/GetParcel', {
      query: { Code: code },
    });
  }

  relaunchParcel(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Parcels/Relaunch', { body: payload });
  }

  relaunchParcelZone(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Parcels/RelaunchZone', {
      body: payload,
    });
  }

  deleteParcel(apiKey: string, code: string) {
    return this.request(apiKey, 'POST', '/Parcels/DeleteParcel', {
      body: { CODE: code },
    });
  }

  async getParcelSticker(apiKey: string, parcelCode: string) {
    let response: Response;

    try {
      response = await fetch(
        this.buildUrl('/PDF/ParcelSticker', { parcelCode }),
        {
          method: 'GET',
          headers: this.getHeaders(apiKey),
        },
      );
    } catch {
      throw new ServiceUnavailableException(
        'ForceLog is currently unreachable',
      );
    }

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

  createPickup(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Pickups/CreateRequest', {
      body: payload,
    });
  }

  getCities(apiKey: string) {
    return this.request(apiKey, 'GET', '/Cities');
  }

  getStock(apiKey: string) {
    return this.request(apiKey, 'GET', '/Stock');
  }

  addProduct(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Stock/AddProduct', { body: payload });
  }

  getReturnEligibleParcels(apiKey: string) {
    return this.request(apiKey, 'POST', '/Return/GetParcels');
  }

  requestReturn(apiKey: string, payload: unknown) {
    return this.request(apiKey, 'POST', '/Return/Request', { body: payload });
  }

  private async request<T = unknown>(
    apiKey: string,
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
        headers: this.getHeaders(apiKey),
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch {
      throw new ServiceUnavailableException(
        'ForceLog is currently unreachable',
      );
    }

    const body = await parseProviderJson<T>(response, 'ForceLog');

    if (!response.ok) {
      throw new BadGatewayException({
        message: `ForceLog request failed with status ${response.status}`,
        forcelog: body,
      });
    }

    return body;
  }

  private getHeaders(apiKey: string) {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    };
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const baseUrl = this.configService.get<string>(
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
