import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GRAPH_ORIGIN = 'https://graph.facebook.com';
const DEFAULT_GRAPH_VERSION = 'v21.0';
const DEFAULT_TIMEOUT_MS = 15000;

// Throughput / pair-rate / spam-rate limits and Meta-side outages.
const TRANSIENT_ERROR_CODES = new Set([
  1, 2, 4, 17, 341, 130429, 131000, 131016, 131048, 131056,
]);
// Token expired, revoked, or the app lost access to the WABA.
const AUTH_ERROR_CODES = new Set([102, 190, 200, 10]);

export class MetaGraphError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = 'MetaGraphError';
  }

  get isAuthError(): boolean {
    return (
      this.httpStatus === 401 ||
      (this.code !== null && AUTH_ERROR_CODES.has(this.code))
    );
  }

  get isTransient(): boolean {
    return (
      this.httpStatus === 429 ||
      this.httpStatus >= 500 ||
      this.httpStatus === 0 ||
      (this.code !== null && TRANSIENT_ERROR_CODES.has(this.code))
    );
  }

  /** Stored on the message row, e.g. "131026" or "HTTP_503". */
  get errorCode(): string {
    return this.code !== null ? String(this.code) : `HTTP_${this.httpStatus}`;
  }

  toHttpException(): HttpException {
    if (this.isAuthError) {
      return new UnauthorizedException(
        'WhatsApp access is no longer authorized — reconnect your number',
      );
    }
    if (this.isTransient) {
      return new ServiceUnavailableException(
        'WhatsApp is temporarily unavailable',
      );
    }
    return new BadGatewayException(`WhatsApp: ${this.message}`);
  }
}

export interface MetaPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  rejectedReason: string | null;
}

export interface MetaTemplateInput {
  name: string;
  language: string;
  body: string;
  exampleValues: string[];
}

export interface MetaSendTemplateInput {
  to: string;
  templateName: string;
  language: string;
  bodyParameters: string[];
}

@Injectable()
export class MetaWhatsAppApiService {
  private readonly logger = new Logger(MetaWhatsAppApiService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<string>('WHATSAPP_ENABLED') === 'true';
  }

  assertConfigured(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'WhatsApp automation is not enabled on this server',
      );
    }
    this.required('META_APP_ID');
    this.required('META_APP_SECRET');
  }

  /** What the frontend needs to open Meta's Embedded Signup popup. */
  publicConfig(): {
    enabled: boolean;
    appId: string | null;
    configId: string | null;
    graphApiVersion: string;
  } {
    const enabled = this.isEnabled();
    return {
      enabled,
      appId: enabled
        ? this.configService.get<string>('META_APP_ID')?.trim() || null
        : null,
      configId: enabled
        ? this.configService.get<string>('META_WHATSAPP_CONFIG_ID')?.trim() ||
          null
        : null,
      graphApiVersion: this.version(),
    };
  }

  /** Embedded Signup returns a one-time code; swap it for a business token. */
  async exchangeCode(
    code: string,
  ): Promise<{ accessToken: string; expiresAt: Date | null }> {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: this.required('META_APP_ID'),
      client_secret: this.required('META_APP_SECRET'),
      code,
    });
    let body: Record<string, unknown>;
    try {
      body = await this.request<Record<string, unknown>>(
        'GET',
        `/oauth/access_token?${params.toString()}`,
      );
    } catch (err) {
      if (err instanceof MetaGraphError && err.code === 101) {
        this.logger.error(`Meta rejected the app credentials: ${err.message}`);
        throw new ServiceUnavailableException(
          'WhatsApp sign-in is misconfigured on the server',
        );
      }
      if (err instanceof MetaGraphError && err.code === 100) {
        throw new BadRequestException(
          'The WhatsApp signup code is invalid or expired — please connect again',
        );
      }
      throw err;
    }
    const accessToken = asString(body.access_token);
    if (!accessToken) {
      throw new BadGatewayException('Meta did not return an access token');
    }
    const expiresIn = asNumber(body.expires_in);
    return {
      accessToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  }

  async listPhoneNumberIds(
    accessToken: string,
    wabaId: string,
  ): Promise<string[]> {
    const body = await this.request<{ data?: Array<{ id?: unknown }> }>(
      'GET',
      `/${encodeURIComponent(wabaId)}/phone_numbers?fields=id&limit=100`,
      accessToken,
    );
    return (body.data ?? [])
      .map((row) => asString(row.id))
      .filter((id): id is string => !!id);
  }

  async getPhoneNumber(
    accessToken: string,
    phoneNumberId: string,
  ): Promise<MetaPhoneNumber> {
    const body = await this.request<Record<string, unknown>>(
      'GET',
      `/${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name`,
      accessToken,
    );
    return {
      id: asString(body.id) ?? phoneNumberId,
      displayPhoneNumber: asString(body.display_phone_number),
      verifiedName: asString(body.verified_name),
    };
  }

  /** Routes this WABA's message/template webhooks to our app. */
  async subscribeApp(accessToken: string, wabaId: string): Promise<void> {
    await this.request(
      'POST',
      `/${encodeURIComponent(wabaId)}/subscribed_apps`,
      accessToken,
    );
  }

  async unsubscribeApp(accessToken: string, wabaId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/${encodeURIComponent(wabaId)}/subscribed_apps`,
      accessToken,
    );
  }

  /** Enables Cloud API sending on the number; `pin` becomes its 2FA PIN. */
  async registerPhone(
    accessToken: string,
    phoneNumberId: string,
    pin: string,
  ): Promise<void> {
    await this.request(
      'POST',
      `/${encodeURIComponent(phoneNumberId)}/register`,
      accessToken,
      { messaging_product: 'whatsapp', pin },
    );
  }

  async listTemplates(
    accessToken: string,
    wabaId: string,
  ): Promise<MetaTemplate[]> {
    const templates: MetaTemplate[] = [];
    let path: string | null =
      `/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,status,rejected_reason&limit=100`;

    // Hard stop so a misbehaving cursor can't loop forever.
    for (let page = 0; path && page < 20; page++) {
      const body: {
        data?: Array<Record<string, unknown>>;
        paging?: { cursors?: { after?: unknown }; next?: unknown };
      } = await this.request('GET', path, accessToken);
      for (const row of body.data ?? []) {
        const id = asString(row.id);
        const name = asString(row.name);
        const language = asString(row.language);
        if (!id || !name || !language) continue;
        templates.push({
          id,
          name,
          language,
          status: asString(row.status) ?? 'PENDING',
          rejectedReason: normalizeRejectedReason(row.rejected_reason),
        });
      }
      const after = asString(body.paging?.cursors?.after);
      path =
        body.paging?.next && after
          ? `/${encodeURIComponent(wabaId)}/message_templates?fields=id,name,language,status,rejected_reason&limit=100&after=${encodeURIComponent(after)}`
          : null;
    }
    return templates;
  }

  async createTemplate(
    accessToken: string,
    wabaId: string,
    input: MetaTemplateInput,
  ): Promise<{ id: string; status: string }> {
    const body = await this.request<Record<string, unknown>>(
      'POST',
      `/${encodeURIComponent(wabaId)}/message_templates`,
      accessToken,
      {
        name: input.name,
        language: input.language,
        category: 'UTILITY',
        components: [
          {
            type: 'BODY',
            text: input.body,
            example: { body_text: [input.exampleValues] },
          },
        ],
      },
    );
    const id = asString(body.id);
    if (!id) {
      throw new BadGatewayException('Meta did not return a template id');
    }
    return { id, status: asString(body.status) ?? 'PENDING' };
  }

  async sendTemplate(
    accessToken: string,
    phoneNumberId: string,
    input: MetaSendTemplateInput,
  ): Promise<{ messageId: string; raw: unknown }> {
    const body = await this.request<{
      messages?: Array<{ id?: unknown }>;
    }>('POST', `/${encodeURIComponent(phoneNumberId)}/messages`, accessToken, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: input.to.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: input.templateName,
        language: { code: input.language },
        components: [
          {
            type: 'body',
            parameters: input.bodyParameters.map((text) => ({
              type: 'text',
              text,
            })),
          },
        ],
      },
    });
    const messageId = asString(body.messages?.[0]?.id);
    if (!messageId) {
      throw new MetaGraphError(
        'Meta did not return a message id',
        502,
        null,
        null,
      );
    }
    return { messageId, raw: body };
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    accessToken?: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        `${GRAPH_ORIGIN}/${this.version()}${path}`,
        {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Meta Graph ${method} request failed: ${(err as Error).message}`,
      );
      throw new MetaGraphError('Meta Graph API is unreachable', 0, null, null);
    }

    const parsed = await readJson(response);
    if (response.ok) return (parsed ?? {}) as T;

    const error =
      isRecord(parsed) && isRecord(parsed.error) ? parsed.error : {};
    throw new MetaGraphError(
      asString(error.error_user_msg) ??
        asString(error.message) ??
        'Meta Graph API request failed',
      response.status,
      asNumber(error.code),
      asNumber(error.error_subcode),
    );
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.configService.get<string>('META_HTTP_TIMEOUT_MS')) ||
        DEFAULT_TIMEOUT_MS,
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private version(): string {
    return (
      this.configService.get<string>('META_GRAPH_API_VERSION')?.trim() ||
      DEFAULT_GRAPH_VERSION
    );
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(
        'WhatsApp automation is not configured on this server',
      );
    }
    return value;
  }
}

function normalizeRejectedReason(value: unknown): string | null {
  const reason = asString(value);
  return reason && reason !== 'NONE' ? reason : null;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(+value))
    return Number(value);
  return null;
}
