import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AmeexMassCodesDto, AmeexParcelDto } from './dto/ameex-parcel.dto';
import { parseProviderJson } from './utils/provider-response';

export type AmeexCredentials = { apiId: string; apiKey: string };

@Injectable()
export class AmeexClient {
  constructor(private readonly config: ConfigService) {}

  checkConnection(credentials: AmeexCredentials) {
    return this.request(credentials, 'GET', '/Delivery/Parcels/Statuts').then(
      (response) => {
        if (providerRejected(response)) {
          throw new BadGatewayException({
            message: 'Ameex credentials were rejected',
            ameex: response,
          });
        }
        return response;
      },
    );
  }

  addParcel(credentials: AmeexCredentials, payload: AmeexParcelDto) {
    const fields: Record<string, unknown> = {
      type: payload.type,
      business: credentials.apiId,
      order_num: payload.orderNumber,
      replace: payload.replace ?? false,
      exchange_code: payload.exchangeCode,
      open: payload.open ?? 'NO',
      try: payload.try ?? 'NO',
      fragile: payload.fragile ?? 0,
      receiver: payload.receiver,
      phone: payload.phone,
      city: payload.city,
      address: payload.address,
      comment: payload.comment,
      product: payload.product,
      cod: payload.cod,
    };
    payload.products?.forEach((product, index) => {
      fields[`products[${index}][id]`] = product.id;
      fields[`products[${index}][qty]`] = product.qty;
    });
    return this.request(
      credentials,
      'POST',
      '/Delivery/Parcels/Action/Type/Add',
      {
        fields,
      },
    );
  }

  getParcelInfo(credentials: AmeexCredentials, code: string) {
    return this.request(credentials, 'GET', '/Delivery/Parcels/Info', {
      query: { ParcelCode: code },
    });
  }

  getTracking(credentials: AmeexCredentials, code: string) {
    return this.request(credentials, 'GET', '/Delivery/Parcels/Tracking', {
      query: { ParcelCode: code },
    });
  }

  getStatuses(credentials: AmeexCredentials) {
    return this.checkConnection(credentials);
  }

  massTracking(credentials: AmeexCredentials, payload: AmeexMassCodesDto) {
    return this.request(credentials, 'POST', '/Delivery/Parcels/MassTracking', {
      fields: { codes: payload.codes.join(',') },
    });
  }

  listParcels(
    credentials: AmeexCredentials,
    options: { start?: number; length?: number; search?: string } = {},
  ) {
    return this.request(credentials, 'POST', '/Delivery/Parcels/Json', {
      fields: {
        start: options.start ?? 0,
        length: options.length ?? 20,
        'search[value]': options.search ?? '',
        'search[regex]': false,
        'date[from]': '01/01/2000',
        'date[to]': formatUsDate(new Date()),
        all_data: 1,
      },
    });
  }

  private async request<T = unknown>(
    credentials: AmeexCredentials,
    method: string,
    path: string,
    options: {
      query?: Record<string, string | number>;
      fields?: Record<string, unknown>;
    } = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl()}${path}`);
    Object.entries(options.query ?? {}).forEach(([key, value]) =>
      url.searchParams.set(key, String(value)),
    );
    const form = options.fields ? new FormData() : undefined;
    Object.entries(options.fields ?? {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        form!.append(key, formValue(value));
      }
    });
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          'C-Api-Id': credentials.apiId,
          'C-Api-Key': credentials.apiKey,
        },
        body: form,
      });
    } catch {
      throw new ServiceUnavailableException('Ameex is currently unreachable');
    }
    const body = await parseProviderJson<T>(response, 'Ameex');
    if (!response.ok) {
      throw new BadGatewayException({
        message: `Ameex request failed with status ${response.status}`,
        ameex: body,
      });
    }
    if (providerRejected(body)) {
      throw new BadGatewayException({
        message: 'Ameex rejected the request',
        ameex: body,
      });
    }
    return body;
  }

  private baseUrl() {
    return this.config
      .get<string>('AMEEX_API_BASE_URL', 'https://api.ameex.app/customer')
      .replace(/\/+$/, '');
  }
}

function formValue(value: unknown) {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function formatUsDate(value: Date) {
  return [
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    String(value.getUTCDate()).padStart(2, '0'),
    value.getUTCFullYear(),
  ].join('/');
}

function providerRejected(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(providerRejected);
  const record = value as Record<string, unknown>;
  if (record.success === false || record.status === false) return true;
  if (
    typeof record.login === 'string' &&
    record.login.toLowerCase() !== 'success'
  ) {
    return true;
  }
  if (
    typeof record.type === 'string' &&
    ['ERROR', 'FAILED', 'FAIL', 'DANGER', 'UNAUTHORIZED'].includes(
      record.type.toUpperCase(),
    )
  ) {
    return true;
  }
  const result = record.RESULT;
  if (
    typeof result === 'string' &&
    ['ERROR', 'FAILED', 'FAIL', 'UNAUTHORIZED'].includes(result.toUpperCase())
  ) {
    return true;
  }
  return Object.values(record).some(providerRejected);
}
