import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  OzoneExpressDeliveryNoteParcelsDto,
  OzoneExpressParcelDto,
} from './dto/ozoneexpress-parcel.dto';
import { parseProviderJson } from './utils/provider-response';

export interface OzoneExpressCredentials {
  customerId: string;
  apiKey: string;
}

type OzoneExpressAuthResponse = {
  CHECK_API?: {
    RESULT?: string;
    MESSAGE?: string;
  };
};

@Injectable()
export class OzoneExpressClient {
  constructor(private readonly configService: ConfigService) {}

  async checkConnection(credentials: OzoneExpressCredentials) {
    const response = await this.getParcelInfo(
      credentials,
      'ZOMAAL_CONNECTION_TEST_DO_NOT_EXIST',
    );

    if (response.CHECK_API?.RESULT !== 'SUCCESS') {
      throw new UnauthorizedException(
        response.CHECK_API?.MESSAGE || 'OzoneExpress credentials were rejected',
      );
    }

    return { authenticated: true };
  }

  addParcel(
    credentials: OzoneExpressCredentials,
    payload: OzoneExpressParcelDto,
  ) {
    return this.postForm(
      credentials,
      '/add-parcel',
      this.mapParcelPayload(payload),
    );
  }

  getParcelInfo(
    credentials: OzoneExpressCredentials,
    trackingNumber: string,
  ): Promise<OzoneExpressAuthResponse> {
    return this.postForm(credentials, '/parcel-info', {
      'tracking-number': trackingNumber,
    });
  }

  track(
    credentials: OzoneExpressCredentials,
    trackingNumber: string | string[],
  ) {
    if (Array.isArray(trackingNumber)) {
      return this.postJson(credentials, '/tracking', {
        'tracking-number': trackingNumber,
      });
    }

    return this.postForm(credentials, '/tracking', {
      'tracking-number': trackingNumber,
    });
  }

  createDeliveryNote(credentials: OzoneExpressCredentials) {
    return this.postForm(credentials, '/add-delivery-note');
  }

  addParcelsToDeliveryNote(
    credentials: OzoneExpressCredentials,
    payload: OzoneExpressDeliveryNoteParcelsDto,
  ) {
    const fields: Record<string, string> = {
      Ref: payload.ref,
    };

    payload.codes.forEach((code, index) => {
      fields[`Codes[${index}]`] = code;
    });

    return this.postForm(credentials, '/add-parcel-to-delivery-note', fields);
  }

  saveDeliveryNote(credentials: OzoneExpressCredentials, ref: string) {
    return this.postForm(credentials, '/save-delivery-note', {
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

  private async postForm<T = unknown>(
    credentials: OzoneExpressCredentials,
    path: string,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    const formData = new FormData();

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, this.stringifyFormValue(value));
      }
    }

    return this.request('POST', this.buildCustomerUrl(path, credentials), {
      body: formData,
    });
  }

  private postJson(
    credentials: OzoneExpressCredentials,
    path: string,
    body: unknown,
  ) {
    return this.request('POST', this.buildCustomerUrl(path, credentials), {
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
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...options.headers,
        },
        body: options.body,
      });
    } catch {
      throw new ServiceUnavailableException(
        'OzoneExpress is currently unreachable',
      );
    }

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

  private buildCustomerUrl(path: string, credentials: OzoneExpressCredentials) {
    const normalizedPath = path.replace(/^\/+/, '');

    return `${this.getApiBaseUrl()}/customers/${encodeURIComponent(
      credentials.customerId,
    )}/${encodeURIComponent(credentials.apiKey)}/${normalizedPath}`;
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
}
