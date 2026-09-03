import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ============================================================================
// VERIFY AGAINST LIVE DOCS ONCE THE TIKTOK APP EXISTS
// (business-api.tiktok.com/portal/docs — requires an approved developer app
// to browse in full; this build is against externally-corroborated info
// gathered without portal access). The spots most likely to need a small
// adjustment are marked "‼" below — everything else follows the documented
// TikTok Business API v1.3 conventions with reasonable confidence.
// ============================================================================

const AUTHORIZE_ENDPOINT = 'https://ads.tiktok.com/marketing_api/auth';
const API_ORIGIN = 'https://business-api.tiktok.com';
const API_BASE = `${API_ORIGIN}/open_api/v1.3`;

interface TikTokApiEnvelope<T> {
  code?: unknown;
  message?: unknown;
  request_id?: unknown;
  data?: T;
}

export interface TikTokTokenSet {
  accessToken: string;
  advertiserIds: string[];
  scope: string[];
}

export interface TikTokAdvertiserDetails {
  advertiserId: string;
  name: string | null;
  currency: string | null;
  timezone: string | null;
}

export interface TikTokCampaign {
  externalCampaignId: string;
  name: string;
  status: string;
  objective: string | null;
  budget: number | null;
  budgetMode: string | null;
  createTime: string | null;
  raw: unknown;
}

export interface TikTokDailyMetric {
  date: string; // YYYY-MM-DD
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  results: number;
  reach: number | null;
  frequency: number | null;
  cpm: number | null;
  ctr: number | null;
  costPerResult: number | null;
  conversionRate: number | null;
  raw: unknown;
}

@Injectable()
export class TikTokAdsApiService {
  constructor(private readonly configService: ConfigService) {}

  assertConfigured(): void {
    if (!this.configService.get<boolean>('TIKTOK_ADS_ENABLED', false)) {
      throw new ServiceUnavailableException(
        'TikTok Ads integration is not enabled',
      );
    }
    this.required('TIKTOK_ADS_APP_ID');
    this.required('TIKTOK_ADS_APP_SECRET');
    this.required('TIKTOK_ADS_REDIRECT_URI');
  }

  buildAuthorizationUrl(state: string): string {
    this.assertConfigured();
    const url = new URL(AUTHORIZE_ENDPOINT);
    url.searchParams.set('app_id', this.required('TIKTOK_ADS_APP_ID'));
    url.searchParams.set(
      'redirect_uri',
      this.required('TIKTOK_ADS_REDIRECT_URI'),
    );
    url.searchParams.set('state', state);
    return url.toString();
  }

  // POST /oauth2/access_token/ — body: {app_id, secret, auth_code}.
  // Unlike standard OAuth2, TikTok's Marketing API does not currently issue
  // a refresh_token on this flow; the returned access_token is long-lived
  // (TikTok's stated policy, not expiry-timestamped in the response) and
  // stays valid until the advertiser revokes access. There is therefore no
  // refresh cycle here, unlike YouCan/Shopify — a REAUTHORIZATION_REQUIRED
  // connection can only be fixed by the merchant reconnecting.
  async exchangeAuthorizationCode(authCode: string): Promise<TikTokTokenSet> {
    this.assertConfigured();
    const response = await this.fetchWithTimeout(
      `${API_BASE}/oauth2/access_token/`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.required('TIKTOK_ADS_APP_ID'),
          secret: this.required('TIKTOK_ADS_APP_SECRET'),
          auth_code: authCode,
        }),
      },
    );
    const envelope = await this.parseEnvelope<Record<string, unknown>>(
      response,
      'TikTok OAuth token exchange failed',
    );

    const data = envelope.data;
    if (!isRecord(data)) {
      throw new BadGatewayException(
        'TikTok did not return the expected OAuth token payload',
      );
    }
    const accessToken = asNonEmptyString(data.access_token);
    if (!accessToken) {
      throw new BadGatewayException('TikTok did not return an access_token');
    }
    const advertiserIds = Array.isArray(data.advertiser_ids)
      ? data.advertiser_ids.map((id) => String(id)).filter(Boolean)
      : [];
    const scope = Array.isArray(data.scope)
      ? data.scope.map((s) => String(s))
      : [];

    return { accessToken, advertiserIds, scope };
  }

  // GET /oauth2/advertiser/get/ — the authoritative list of advertiser
  // accounts this access_token was actually granted, independent of
  // whatever advertiser_ids the token-exchange response happened to
  // include (that field isn't reliably populated on every app
  // configuration). Called right after exchangeAuthorizationCode as the
  // primary source; its own advertiser_ids is only a fallback.
  //
  // ‼ Unlike every other GET in this file, TikTok documents this one taking
  // app_id/secret/Access-Token together rather than just the access-token
  // header — verify against the live docs once reachable.
  async getAuthorizedAdvertiserIds(accessToken: string): Promise<string[]> {
    this.assertConfigured();
    const url = new URL('/oauth2/advertiser/get/', API_BASE + '/');
    url.searchParams.set('app_id', this.required('TIKTOK_ADS_APP_ID'));
    url.searchParams.set('secret', this.required('TIKTOK_ADS_APP_SECRET'));

    const response = await this.fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Access-Token': accessToken,
      },
    });
    const envelope = await this.parseEnvelope<unknown>(
      response,
      'TikTok oauth2/advertiser/get request failed',
    );
    const list = Array.isArray(envelope.data)
      ? envelope.data
      : isRecord(envelope.data) && Array.isArray((envelope.data as Record<string, unknown>).list)
        ? ((envelope.data as Record<string, unknown>).list as unknown[])
        : [];

    return list
      .filter(isRecord)
      .map(
        (entry) =>
          asNonEmptyString(entry.advertiser_id) ?? asNonEmptyString(entry.advertiserId),
      )
      .filter((id): id is string => id !== null);
  }

  // ‼ GET /advertiser/info/ — response field names (name/currency/timezone
  // vs display/currency_code, etc.) are the least certain part of this
  // build; verify once the portal is reachable and adjust the mapping below
  // if TikTok returns different keys.
  async getAdvertiserDetails(
    accessToken: string,
    advertiserIds: string[],
  ): Promise<TikTokAdvertiserDetails[]> {
    if (advertiserIds.length === 0) {
      return [];
    }
    const payload = await this.getJson<unknown[]>(
      accessToken,
      '/advertiser/info/',
      { advertiser_ids: JSON.stringify(advertiserIds) },
    );
    if (!Array.isArray(payload)) {
      throw new BadGatewayException(
        'TikTok advertiser/info did not return a list',
      );
    }
    return payload.filter(isRecord).map((entry) => ({
      advertiserId:
        asNonEmptyString(entry.advertiser_id) ??
        asNonEmptyString(entry.advertiserId) ??
        '',
      name: asNonEmptyString(entry.name),
      currency: asNonEmptyString(entry.currency),
      timezone: asNonEmptyString(entry.timezone),
    }));
  }

  async listCampaigns(
    accessToken: string,
    advertiserId: string,
  ): Promise<TikTokCampaign[]> {
    const results: TikTokCampaign[] = [];
    let page = 1;
    const pageSize = 100;

    // Paginates through every campaign — the "Select Campaigns" screen needs
    // the full list, not just the first page.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await this.getJson<Record<string, unknown>>(
        accessToken,
        '/campaign/get/',
        {
          advertiser_id: advertiserId,
          page: String(page),
          page_size: String(pageSize),
        },
      );
      const list = Array.isArray(payload.list) ? payload.list : [];
      for (const entry of list) {
        if (!isRecord(entry)) {
          continue;
        }
        const externalCampaignId =
          asNonEmptyString(entry.campaign_id) ??
          asNonEmptyString(entry.campaign_id_str);
        const name = asNonEmptyString(entry.campaign_name);
        if (!externalCampaignId || !name) {
          continue;
        }
        results.push({
          externalCampaignId,
          name,
          status: asNonEmptyString(entry.status) ?? asNonEmptyString(entry.operation_status) ?? 'UNKNOWN',
          objective: asNonEmptyString(entry.objective_type),
          budget: positiveNumber(entry.budget),
          budgetMode: asNonEmptyString(entry.budget_mode),
          createTime: asNonEmptyString(entry.create_time),
          raw: entry,
        });
      }

      const pageInfo = isRecord(payload.page_info) ? payload.page_info : {};
      const totalPage = positiveNumber(pageInfo.total_page) ?? 1;
      if (page >= totalPage || list.length === 0) {
        break;
      }
      page += 1;
    }

    return results;
  }

  // ‼ GET /report/integrated/get/ — dimensions/metrics/filtering are
  // typically passed as JSON-encoded array strings in the query string per
  // TikTok's documented convention; verify the exact metric key names
  // (e.g. "result" vs "results", "cost_per_result") against the live docs —
  // the mapping below is best-effort and defensive (missing/renamed metrics
  // just come back as null rather than throwing).
  //
  // ‼ result/conversion-family metrics (result, cost_per_result,
  // conversion_rate) may not be queryable at AUCTION_CAMPAIGN level when a
  // campaign's ad groups have different optimization goals — TikTok's own
  // docs flag this. If a real account hits a 400 here, the fix is likely
  // dropping those three from `metrics` and reading them per-ad-group
  // instead; getJson()'s error already surfaces TikTok's message verbatim
  // so this will fail loudly, not silently, if it happens.
  async getDailyMetrics(
    accessToken: string,
    advertiserId: string,
    campaignIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<TikTokDailyMetric[]> {
    if (campaignIds.length === 0) {
      return [];
    }

    const results: TikTokDailyMetric[] = [];
    let page = 1;
    const pageSize = 100;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const payload = await this.getJson<Record<string, unknown>>(
        accessToken,
        '/report/integrated/get/',
        {
          advertiser_id: advertiserId,
          service_type: 'AUCTION',
          report_type: 'BASIC',
          data_level: 'AUCTION_CAMPAIGN',
          dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
          metrics: JSON.stringify([
            'spend',
            'clicks',
            'impressions',
            'result',
            'reach',
            'frequency',
            'cpm',
            'ctr',
            'cost_per_result',
            'conversion_rate',
          ]),
          filtering: JSON.stringify([
            {
              field_name: 'campaign_ids',
              filter_type: 'IN',
              filter_value: JSON.stringify(campaignIds),
            },
          ]),
          start_date: startDate,
          end_date: endDate,
          page: String(page),
          page_size: String(pageSize),
        },
      );

      const list = Array.isArray(payload.list) ? payload.list : [];
      for (const entry of list) {
        if (!isRecord(entry)) {
          continue;
        }
        const dimensions = isRecord(entry.dimensions) ? entry.dimensions : {};
        const metrics = isRecord(entry.metrics) ? entry.metrics : {};
        const externalCampaignId = asNonEmptyString(dimensions.campaign_id);
        const date = asNonEmptyString(dimensions.stat_time_day)?.slice(0, 10);
        if (!externalCampaignId || !date) {
          continue;
        }
        results.push({
          date,
          externalCampaignId,
          spend: positiveNumber(metrics.spend) ?? 0,
          clicks: Math.trunc(positiveNumber(metrics.clicks) ?? 0),
          impressions: Math.trunc(positiveNumber(metrics.impressions) ?? 0),
          results: Math.trunc(positiveNumber(metrics.result) ?? 0),
          reach: positiveNumber(metrics.reach),
          frequency: positiveNumber(metrics.frequency),
          cpm: positiveNumber(metrics.cpm),
          ctr: positiveNumber(metrics.ctr),
          costPerResult: positiveNumber(metrics.cost_per_result),
          conversionRate: positiveNumber(metrics.conversion_rate),
          raw: entry,
        });
      }

      const pageInfo = isRecord(payload.page_info) ? payload.page_info : {};
      const totalPage = positiveNumber(pageInfo.total_page) ?? 1;
      if (page >= totalPage || list.length === 0) {
        break;
      }
      page += 1;
    }

    return results;
  }

  // POST /campaign/status/update/ — sets ENABLE/DISABLE. Not called by
  // anything yet (pause/resume is deferred, see the ads module README-style
  // comment in ads.module.ts) — implemented now since it needs no new
  // request-shape research once the read path is verified, but intentionally
  // unwired from any controller.
  async setCampaignStatus(
    accessToken: string,
    advertiserId: string,
    externalCampaignId: string,
    operationStatus: 'ENABLE' | 'DISABLE',
  ): Promise<void> {
    const response = await this.fetchWithTimeout(
      `${API_BASE}/campaign/status/update/`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Access-Token': accessToken,
        },
        body: JSON.stringify({
          advertiser_id: advertiserId,
          campaign_ids: [externalCampaignId],
          operation_status: operationStatus,
        }),
      },
    );
    await this.parseEnvelope(response, 'TikTok campaign status update failed');
  }

  isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedException;
  }

  private async getJson<T>(
    accessToken: string,
    path: string,
    query: Record<string, string>,
  ): Promise<T> {
    this.assertConfigured();
    const url = new URL(path, API_BASE + '/');
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const response = await this.fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // Documented TikTok Business API convention — a custom header, not
        // a standard OAuth "Authorization: Bearer" header.
        'Access-Token': accessToken,
      },
    });
    const envelope = await this.parseEnvelope<T>(response, 'TikTok API request failed');
    return envelope.data as T;
  }

  private async parseEnvelope<T>(
    response: Response,
    failureMessage: string,
  ): Promise<TikTokApiEnvelope<T>> {
    if (response.status === 401) {
      throw new UnauthorizedException('TikTok access token is no longer authorized');
    }
    if (response.status === 403) {
      throw new ForbiddenException(
        'TikTok denied this operation. Reconnect the account with the required scopes.',
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new ServiceUnavailableException('TikTok API is temporarily unavailable');
    }
    if (!response.ok) {
      throw new BadGatewayException(failureMessage);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new BadGatewayException('TikTok returned a non-JSON response');
    }
    if (!isRecord(body)) {
      throw new BadGatewayException('TikTok returned an unexpected response shape');
    }

    // TikTok's envelope reports success/failure via `code: 0`, separately
    // from the HTTP status (which is usually 200 even on business errors).
    const code = positiveNumber(body.code) ?? (body.code === 0 ? 0 : null);
    if (code !== null && code !== 0) {
      const message = asNonEmptyString(body.message) ?? failureMessage;
      if (code === 40100 || code === 40105) {
        throw new UnauthorizedException(message);
      }
      throw new BadGatewayException(`TikTok: ${message}`);
    }

    return body as TikTokApiEnvelope<T>;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.configService.get<number>('TIKTOK_ADS_HTTP_TIMEOUT_MS', 15000),
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException('Unable to reach TikTok');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function positiveNumber(value: unknown): number | null {
  const num = typeof value === 'string' ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}
