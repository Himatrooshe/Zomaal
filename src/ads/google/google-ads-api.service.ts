import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Google Ads API over REST (no client library). OAuth tokens come from
// Google's standard OAuth 2.0 endpoints. API access level is tied to the
// Google Cloud project that owns the OAuth client; developer tokens were
// sunset on 2026-09-09 and are sent only if configured (Google ignores them).
// Field names in REST responses are camelCase and
// int64 values (ids, *_micros) arrive as strings.
// Versions are sunset roughly a year after release — keep
// GOOGLE_ADS_API_VERSION current (developers.google.com/google-ads/api/docs/release-notes).

const AUTHORIZE_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const API_ORIGIN = 'https://googleads.googleapis.com';
const DEFAULT_API_VERSION = 'v25';
export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';

const MICROS = 1_000_000;

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string[];
}

export interface GoogleAdsCustomer {
  customerId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
  isManager: boolean;
  isTestAccount: boolean;
  status: string | null;
}

export interface GoogleAdsCampaign {
  externalCampaignId: string;
  name: string;
  status: string;
  channelType: string | null;
  budget: number | null;
  raw: unknown;
}

export interface GoogleAdsDailyMetric {
  date: string; // YYYY-MM-DD
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
  cpm: number | null;
  ctr: number | null; // percent
  costPerConversion: number | null;
  conversionRate: number | null; // percent
  raw: unknown;
}

export type GoogleCampaignStatus = 'ENABLED' | 'PAUSED';

@Injectable()
export class GoogleAdsApiService {
  private readonly logger = new Logger(GoogleAdsApiService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<string>('GOOGLE_ADS_ENABLED') === 'true';
  }

  assertConfigured(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'Google Ads integration is not enabled',
      );
    }
    this.required('GOOGLE_ADS_CLIENT_ID');
    this.required('GOOGLE_ADS_CLIENT_SECRET');
    this.required('GOOGLE_ADS_REDIRECT_URI');
  }

  buildAuthorizationUrl(state: string): string {
    this.assertConfigured();
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set('client_id', this.required('GOOGLE_ADS_CLIENT_ID'));
    url.searchParams.set(
      'redirect_uri',
      this.required('GOOGLE_ADS_REDIRECT_URI'),
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', GOOGLE_ADS_SCOPE);
    // offline + consent: Google only returns a refresh_token on consent, and
    // access tokens last ~1 hour, so the sync depends on it.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeAuthorizationCode(code: string): Promise<GoogleTokenSet> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.required('GOOGLE_ADS_REDIRECT_URI'),
    });
  }

  refreshAccessToken(refreshToken: string): Promise<GoogleTokenSet> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  /** Customer ids (digits) the signed-in Google user can access directly. */
  async listAccessibleCustomerIds(accessToken: string): Promise<string[]> {
    const body = await this.adsRequest<{ resourceNames?: unknown }>(
      accessToken,
      'GET',
      '/customers:listAccessibleCustomers',
    );
    const names = Array.isArray(body.resourceNames) ? body.resourceNames : [];
    return names
      .map((name) =>
        typeof name === 'string' ? name.replace(/^customers\//, '') : '',
      )
      .filter((id) => /^\d+$/.test(id));
  }

  async getCustomer(
    accessToken: string,
    customerId: string,
  ): Promise<GoogleAdsCustomer | null> {
    const rows = await this.search(
      accessToken,
      customerId,
      `SELECT customer.id, customer.descriptive_name, customer.currency_code,
              customer.time_zone, customer.manager, customer.test_account,
              customer.status
       FROM customer LIMIT 1`,
    );
    const customer = isRecord(rows[0]?.customer) ? rows[0].customer : null;
    if (!customer) return null;
    return {
      customerId: asString(customer.id) ?? customerId,
      name: asString(customer.descriptiveName),
      currency: asString(customer.currencyCode),
      timezone: asString(customer.timeZone),
      isManager: customer.manager === true,
      isTestAccount: customer.testAccount === true,
      status: asString(customer.status),
    };
  }

  async listCampaigns(
    accessToken: string,
    customerId: string,
  ): Promise<GoogleAdsCampaign[]> {
    const rows = await this.search(
      accessToken,
      customerId,
      `SELECT campaign.id, campaign.name, campaign.status,
              campaign.advertising_channel_type, campaign_budget.amount_micros
       FROM campaign
       WHERE campaign.status != 'REMOVED'
       ORDER BY campaign.name`,
    );
    const campaigns: GoogleAdsCampaign[] = [];
    for (const row of rows) {
      const campaign = isRecord(row.campaign) ? row.campaign : null;
      const id = asString(campaign?.id);
      const name = asString(campaign?.name);
      if (!campaign || !id || !name) continue;
      const budget = isRecord(row.campaignBudget)
        ? asNumber(row.campaignBudget.amountMicros)
        : null;
      campaigns.push({
        externalCampaignId: id,
        name,
        status: asString(campaign.status) ?? 'UNKNOWN',
        channelType: asString(campaign.advertisingChannelType),
        budget: budget !== null ? budget / MICROS : null,
        raw: row,
      });
    }
    return campaigns;
  }

  async getDailyMetrics(
    accessToken: string,
    customerId: string,
    campaignIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<GoogleAdsDailyMetric[]> {
    const ids = campaignIds.filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) return [];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      throw new BadGatewayException('Invalid Google Ads report date range');
    }

    const rows = await this.search(
      accessToken,
      customerId,
      `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks,
              metrics.impressions, metrics.conversions, metrics.average_cpm,
              metrics.ctr, metrics.cost_per_conversion,
              metrics.conversions_from_interactions_rate
       FROM campaign
       WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
         AND campaign.id IN (${ids.join(',')})`,
    );

    const metrics: GoogleAdsDailyMetric[] = [];
    for (const row of rows) {
      const campaign = isRecord(row.campaign) ? row.campaign : {};
      const segments = isRecord(row.segments) ? row.segments : {};
      const m = isRecord(row.metrics) ? row.metrics : {};
      const id = asString(campaign.id);
      const date = asString(segments.date);
      if (!id || !date) continue;

      const costPerConversion = asNumber(m.costPerConversion);
      const averageCpm = asNumber(m.averageCpm);
      const ctr = asNumber(m.ctr);
      const convRate = asNumber(m.conversionsFromInteractionsRate);
      metrics.push({
        date,
        externalCampaignId: id,
        // Zero-valued metrics are omitted from REST responses.
        spend: (asNumber(m.costMicros) ?? 0) / MICROS,
        clicks: Math.trunc(asNumber(m.clicks) ?? 0),
        impressions: Math.trunc(asNumber(m.impressions) ?? 0),
        conversions: asNumber(m.conversions) ?? 0,
        cpm: averageCpm !== null ? averageCpm / MICROS : null,
        ctr: ctr !== null ? ctr * 100 : null,
        costPerConversion:
          costPerConversion !== null ? costPerConversion / MICROS : null,
        conversionRate: convRate !== null ? convRate * 100 : null,
        raw: row,
      });
    }
    return metrics;
  }

  async setCampaignStatus(
    accessToken: string,
    customerId: string,
    externalCampaignId: string,
    status: GoogleCampaignStatus,
  ): Promise<void> {
    assertDigits(customerId);
    assertDigits(externalCampaignId);
    await this.adsRequest(
      accessToken,
      'POST',
      `/customers/${customerId}/campaigns:mutate`,
      {
        operations: [
          {
            update: {
              resourceName: `customers/${customerId}/campaigns/${externalCampaignId}`,
              status,
            },
            updateMask: 'status',
          },
        ],
      },
    );
  }

  isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedException;
  }

  /** GAQL search, following nextPageToken until every row is read. */
  private async search(
    accessToken: string,
    customerId: string,
    query: string,
  ): Promise<Record<string, unknown>[]> {
    assertDigits(customerId);
    const rows: Record<string, unknown>[] = [];
    let pageToken: string | undefined;
    do {
      const body = await this.adsRequest<{
        results?: unknown;
        nextPageToken?: unknown;
      }>(accessToken, 'POST', `/customers/${customerId}/googleAds:search`, {
        query: query.replace(/\s+/g, ' ').trim(),
        ...(pageToken ? { pageToken } : {}),
      });
      if (Array.isArray(body.results))
        rows.push(...body.results.filter(isRecord));
      pageToken = asString(body.nextPageToken) ?? undefined;
    } while (pageToken);
    return rows;
  }

  private async adsRequest<T>(
    accessToken: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    this.assertConfigured();
    const version =
      this.configService.get<string>('GOOGLE_ADS_API_VERSION')?.trim() ||
      DEFAULT_API_VERSION;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
    const developerToken = this.configService
      .get<string>('GOOGLE_ADS_DEVELOPER_TOKEN')
      ?.trim();
    if (developerToken) headers['developer-token'] = developerToken;
    const loginCustomerId = this.configService
      .get<string>('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
      ?.replace(/\D/g, '');
    if (loginCustomerId) headers['login-customer-id'] = loginCustomerId;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await this.fetchWithTimeout(
      `${API_ORIGIN}/${version}${path}`,
      {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      },
    );
    const parsed = await readJson(response);

    if (response.ok) return (parsed ?? {}) as T;

    const message =
      googleErrorMessage(parsed) ?? 'Google Ads API request failed';
    if (response.status === 401) {
      throw new UnauthorizedException(
        'Google Ads access is no longer authorized',
      );
    }
    if (response.status === 403) {
      throw new ForbiddenException(`Google Ads: ${message}`);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ServiceUnavailableException(
        'Google Ads API is temporarily unavailable',
      );
    }
    throw new BadGatewayException(`Google Ads: ${message}`);
  }

  private async tokenRequest(
    params: Record<string, string>,
  ): Promise<GoogleTokenSet> {
    this.assertConfigured();
    const response = await this.fetchWithTimeout(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.required('GOOGLE_ADS_CLIENT_ID'),
        client_secret: this.required('GOOGLE_ADS_CLIENT_SECRET'),
      }).toString(),
    });
    const body = await readJson(response);

    if (!response.ok || !isRecord(body)) {
      const error = isRecord(body) ? asString(body.error) : null;
      // invalid_grant: code reused/expired, or refresh token revoked.
      if (error === 'invalid_grant') {
        throw new UnauthorizedException(
          'Google authorization is no longer valid',
        );
      }
      // Server-side credential problem; must not flag merchant connections for reauth.
      if (error === 'invalid_client' || error === 'unauthorized_client') {
        this.logger.error(`Google OAuth client rejected: ${error}`);
        throw new ServiceUnavailableException(
          'Google Ads sign-in is misconfigured on the server',
        );
      }
      if (response.status >= 500 || response.status === 429) {
        throw new ServiceUnavailableException(
          'Google sign-in is temporarily unavailable',
        );
      }
      throw new BadGatewayException('Google OAuth token request failed');
    }

    const accessToken = asString(body.access_token);
    if (!accessToken) {
      throw new BadGatewayException('Google did not return an access token');
    }
    const expiresIn = asNumber(body.expires_in) ?? 3600;
    return {
      accessToken,
      refreshToken: asString(body.refresh_token),
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      scope: (asString(body.scope) ?? '').split(' ').filter(Boolean),
    };
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.configService.get<string>('GOOGLE_ADS_HTTP_TIMEOUT_MS')) ||
        20000,
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException('Unable to reach Google');
    } finally {
      clearTimeout(timeout);
    }
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** First GoogleAdsFailure message, else the top-level status message. */
function googleErrorMessage(body: unknown): string | null {
  if (!isRecord(body) || !isRecord(body.error)) return null;
  const details = Array.isArray(body.error.details) ? body.error.details : [];
  for (const detail of details) {
    if (isRecord(detail) && Array.isArray(detail.errors)) {
      const first = detail.errors.find(isRecord);
      const message = first ? asString(first.message) : null;
      if (message) return message;
    }
  }
  return asString(body.error.message);
}

function assertDigits(value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new BadGatewayException('Invalid Google Ads id');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}
