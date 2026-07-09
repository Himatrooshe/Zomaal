import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressParcelDto,
} from './dto/ozoneexpress-parcel.dto';
import { parseProviderJson } from './utils/provider-response';

@Injectable()
export class OzoneExpressClient {
  constructor(private readonly configService: ConfigService) {}

  checkConnection() {
    return this.getCities();
  }

  addParcel(payload: OzoneExpressParcelDto) {
    return this.postForm('/add-parcel', this.mapParcelPayload(payload));
  }

  getParcelInfo(trackingNumber: string) {
    return this.postForm('/parcel-info', {
      'tracking-number': trackingNumber,
    });
  }

  track(trackingNumber: string | string[]) {
    if (Array.isArray(trackingNumber)) {
      return this.postJson('/tracking', {
        'tracking-number': trackingNumber,
      });
    }

    return this.postForm('/tracking', {
      'tracking-number': trackingNumber,
    });
  }

  createDeliveryNote() {
    return this.postForm('/add-delivery-note');
  }

  addParcelsToDeliveryNote(payload: OzoneExpressDeliveryNoteParcelsDto) {
    const fields: Record<string, string> = {
      Ref: payload.ref,
    };

    payload.codes.forEach((code, index) => {
      fields[`Codes[${index}]`] = code;
    });

    return this.postForm('/add-parcel-to-delivery-note', fields);
  }

  saveDeliveryNote(ref: string) {
    return this.postForm('/save-delivery-note', {
      Ref: ref,
    });
  }

  getDeliveryNotePdfLinks(ref: string) {
    const clientBaseUrl = this.getClientBaseUrl();

    return {
      ref,
      pdfStandard: `${clientBaseUrl}/pdf-delivery-note?dn-ref=${encodeURIComponent(ref)}`,
      labelsA4: `${clientBaseUrl}/pdf-delivery-note-tickets?dn-ref=${encodeURIComponent(ref)}`,
      labels10x10: `${clientBaseUrl}/pdf-delivery-note-tickets-4-4?dn-ref=${encodeURIComponent(ref)}`,
    };
  }

  getCities() {
    return this.request('GET', `${this.getApiBaseUrl()}/cities`);
  }

  private async postForm(path: string, fields: Record<string, unknown> = {}) {
    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, this.stringifyFormValue(value));
      }
    }

    return this.request('POST', this.buildCustomerUrl(path), {
      body: formData,
    });
  }

  private postJson(path: string, body: unknown) {
    return this.request('POST', this.buildCustomerUrl(path), {
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  private stringifyFormValue(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return String(value);
    }

    return JSON.stringify(value);
  }

  private async request<T = unknown>(
    method: string,
    url: string,
    options: {
      body?: BodyInit;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...options.headers,
      },
      body: options.body,
    });

    const body = await parseProviderJson<T>(response, 'OzoneExpress');

    if (!response.ok) {
      throw new BadGatewayException({
        message: `OzoneExpress request failed with status ${response.status}`,
        ozoneexpress: body,
      });
    }

    return body;
  }

  private mapParcelPayload(payload: OzoneExpressParcelDto) {
    return {
      'tracking-number': payload.trackingNumber,
      'parcel-receiver': payload.receiver,
      'parcel-phone': payload.phone,
      'parcel-city': payload.city,
      'parcel-address': payload.address,
      'parcel-note': payload.note,
      'parcel-price': payload.price,
      'parcel-nature': payload.nature,
      'parcel-stock': payload.stock,
      'parcel-open': payload.open,
      'parcel-fragile': payload.fragile,
      'parcel-replace': payload.replace,
      products: payload.products ? JSON.stringify(payload.products) : undefined,
    };
  }

  private buildCustomerUrl(path: string) {
    const normalizedPath = path.replace(/^\/+/, '');

    return `${this.getApiBaseUrl()}/customers/${encodeURIComponent(
      this.getCustomerId(),
    )}/${encodeURIComponent(this.getApiKey())}/${normalizedPath}`;
  }

  private getApiBaseUrl() {
    return this.configService
      .get<string>('OZONEEXPRESS_API_BASE_URL', 'https://api.ozonexpress.ma')
      .replace(/\/+$/, '');
  }

  private getClientBaseUrl() {
    return this.configService
      .get<string>(
        'OZONEEXPRESS_CLIENT_BASE_URL',
        'https://client.ozoneexpress.ma',
      )
      .replace(/\/+$/, '');
  }

  private getCustomerId(): string {
    const customerId = this.configService.get<string>(
      'OZONEEXPRESS_CUSTOMER_ID',
    );

    if (!customerId) {
      throw new ServiceUnavailableException(
        'OzoneExpress customer ID is not configured',
      );
    }

    return customerId;
  }

  private getApiKey(): string {
    const apiKey = this.configService.get<string>('OZONEEXPRESS_API_KEY');

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'OzoneExpress API key is not configured',
      );
    }

    return apiKey;
  }
}
