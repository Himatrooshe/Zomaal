import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

// Meta Marketing API over the Graph API (no SDK). Sign-in is Facebook Login:
// the code is swapped for a short-lived user token, then for a long-lived one
// (~60 days). Meta issues no refresh token, so an expired or revoked token
// means the merchant reconnects. Every call carries appsecret_proof.
// Marketing API versions live about two years — keep META_ADS_API_VERSION
// current (developers.facebook.com/docs/graph-api/changelog/versions).

const DIALOG_ORIGIN = 'https://www.facebook.com';
const GRAPH_ORIGIN = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v25.0';
const DEFAULT_TIMEOUT_MS = 20000;
const MAX_PAGES = 50;

export const META_ADS_READ_PERMISSION = 'ads_read';
export const META_ADS_MANAGE_PERMISSION = 'ads_management';
const REQUESTED_PERMISSIONS = [
  META_ADS_READ_PERMISSION,
  META_ADS_MANAGE_PERMISSION,
];

// Ad account statuses that can still spend or have recent spend:
// ACTIVE, UNSETTLED, PENDING_RISK_REVIEW, PENDING_SETTLEMENT, IN_GRACE_PERIOD.
// DISABLED (2), PENDING_CLOSURE (100) and CLOSED (101) are left out.
const USABLE_ACCOUNT_STATUSES = new Set([1, 3, 7, 8, 9]);

const AUTH_ERROR_CODES = new Set([102, 190]);
const PERMISSION_ERROR_CODES = new Set([10, 200, 294]);
// Generic throttling, ads-specific rate limits (80000–80014) and outages.
const TRANSIENT_ERROR_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export interface MetaTokenSet {
  accessToken: string;
  /** null = Meta reported no expiry. */
  expiresAt: Date | null;
}

export interface MetaAdAccount {
  accountId: string; // digits, without "act_"
  name: string | null;
  currency: string | null;
  timezone: string | null;
}

export interface MetaCampaign {
  externalCampaignId: string;
  name: string;
  status: string; // ACTIVE | PAUSED
  objective: string | null;
  budget: number | null; // daily, else lifetime, in currency units
  startDate: Date | null;
  endDate: Date | null;
  raw: unknown;
}

export interface MetaDailyInsight {
  date: string; // YYYY-MM-DD
  externalCampaignId: string;
  spend: number;
  linkClicks: number;
  impressions: number;
  reach: number | null;
  frequency: number | null;
  cpm: number | null;
  ctr: number | null; // percent, link clicks / impressions
  actions: Record<string, number>;
  raw: unknown;
}

export type MetaCampaignStatus = 'ACTIVE' | 'PAUSED';

// What Ads Manager counts as a "result" for each campaign objective; the
// first action type present wins (purchase variants overlap, never add them).
const PURCHASES = [
  'omni_purchase',
  'purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
];
const LEADS = [
  'lead',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
];
const MESSAGES = ['onsite_conversion.messaging_conversation_started_7d'];
const RESULT_ACTIONS: Record<string, string[]> = {
  OUTCOME_SALES: PURCHASES,
  CONVERSIONS: PURCHASES,
  PRODUCT_CATALOG_SALES: PURCHASES,
  OUTCOME_LEADS: LEADS,
  LEAD_GENERATION: LEADS,
  MESSAGES,
  OUTCOME_ENGAGEMENT: [...MESSAGES, 'post_engagement'],
  POST_ENGAGEMENT: ['post_engagement'],
  OUTCOME_TRAFFIC: ['link_click'],
  LINK_CLICKS: ['link_click'],
  OUTCOME_APP_PROMOTION: ['mobile_app_install', 'app_install'],
  APP_INSTALLS: ['mobile_app_install', 'app_install'],
  VIDEO_VIEWS: ['video_view'],
  // Awareness is judged on reach and impressions, which have their own columns.
  OUTCOME_AWARENESS: [],
  BRAND_AWARENESS: [],
  REACH: [],
};
const FALLBACK_RESULT_ACTIONS = [...PURCHASES, ...LEADS, ...MESSAGES];

/** Results for one day of a campaign, following its objective. */
export function metaResultCount(
  objective: string | null,
  actions: Record<string, number>,
): number {
  const candidates =
    (objective && RESULT_ACTIONS[objective]) || FALLBACK_RESULT_ACTIONS;
  for (const type of candidates) {
    if (actions[type] !== undefined) return Math.round(actions[type]);
  }
  return 0;
}

export class MetaAdsGraphError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: number | null,
    readonly subcode: number | null,
  ) {
    super(message);
    this.name = 'MetaAdsGraphError';
  }
}

@Injectable()
export class MetaAdsApiService {
  private readonly logger = new Logger(MetaAdsApiService.name);

  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    return this.configService.get<string>('META_ADS_ENABLED') === 'true';
  }

  assertConfigured(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'Meta Ads integration is not enabled',
      );
    }
    this.appId();
    this.appSecret();
    this.required('META_ADS_REDIRECT_URI');
  }

  buildAuthorizationUrl(state: string): string {
    this.assertConfigured();
    const url = new URL(`${DIALOG_ORIGIN}/${this.version()}/dialog/oauth`);
    url.searchParams.set('client_id', this.appId());
    url.searchParams.set(
      'redirect_uri',
      this.required('META_ADS_REDIRECT_URI'),
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    // A Facebook Login for Business configuration carries its own permissions.
    const configId = this.configService
      .get<string>('META_ADS_CONFIG_ID')
      ?.trim();
    if (configId) {
      url.searchParams.set('config_id', configId);
    } else {
      url.searchParams.set('scope', REQUESTED_PERMISSIONS.join(','));
    }
    return url.toString();
  }

  /** Code → short-lived token → long-lived token (~60 days). */
  async exchangeAuthorizationCode(code: string): Promise<MetaTokenSet> {
    this.assertConfigured();
    const short = await this.tokenRequest({
      client_id: this.appId(),
      client_secret: this.appSecret(),
      redirect_uri: this.required('META_ADS_REDIRECT_URI'),
      code,
    });
    try {
      return await this.tokenRequest({
        grant_type: 'fb_exchange_token',
        client_id: this.appId(),
        client_secret: this.appSecret(),
        fb_exchange_token: short.accessToken,
      });
    } catch (error) {
      // Business-integration tokens can't be extended; they are long-lived already.
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(
        `Meta long-lived token exchange failed, keeping the original token: ${error instanceof Error ? error.message : String(error)}`,
      );
      return short;
    }
  }

  async getGrantedPermissions(accessToken: string): Promise<string[]> {
    const rows = await this.paginate(accessToken, '/me/permissions', {});
    return rows
      .filter((row) => row.status === 'granted')
      .map((row) => asString(row.permission))
      .filter((p): p is string => p !== null);
  }

  /** Ad accounts the user can reach that can still spend. */
  async listAdAccounts(accessToken: string): Promise<MetaAdAccount[]> {
    const rows = await this.paginate(accessToken, '/me/adaccounts', {
      fields: 'account_id,name,currency,timezone_name,account_status',
      limit: '100',
    });
    const accounts: MetaAdAccount[] = [];
    for (const row of rows) {
      const accountId = asString(row.account_id);
      const status = asNumber(row.account_status);
      if (!accountId || !/^\d+$/.test(accountId)) continue;
      if (status === null || !USABLE_ACCOUNT_STATUSES.has(status)) continue;
      accounts.push({
        accountId,
        name: asString(row.name),
        currency: asString(row.currency),
        timezone: asString(row.timezone_name),
      });
    }
    return accounts;
  }

  async listCampaigns(
    accessToken: string,
    accountId: string,
    currency: string | null,
  ): Promise<MetaCampaign[]> {
    assertDigits(accountId);
    const rows = await this.paginate(
      accessToken,
      `/act_${accountId}/campaigns`,
      {
        fields:
          'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
        limit: '200',
      },
    );
    const factor = minorUnitFactor(currency);
    const campaigns: MetaCampaign[] = [];
    for (const row of rows) {
      const id = asString(row.id);
      const name = asString(row.name);
      const status = asString(row.status);
      if (!id || !name || !status) continue;
      if (status === 'DELETED' || status === 'ARCHIVED') continue;
      // Budgets come in the currency's smallest unit; null when set per ad set.
      const minor = asNumber(row.daily_budget) || asNumber(row.lifetime_budget);
      campaigns.push({
        externalCampaignId: id,
        name,
        status,
        objective: asString(row.objective),
        budget: minor ? minor / factor : null,
        startDate: asDate(row.start_time),
        endDate: asDate(row.stop_time),
        raw: row,
      });
    }
    return campaigns.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getDailyInsights(
    accessToken: string,
    accountId: string,
    campaignIds: string[],
    startDate: string,
    endDate: string,
  ): Promise<MetaDailyInsight[]> {
    assertDigits(accountId);
    const ids = campaignIds.filter((id) => /^\d+$/.test(id));
    if (ids.length === 0) return [];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
    ) {
      throw new BadGatewayException('Invalid Meta Ads report date range');
    }

    const rows = await this.paginate(
      accessToken,
      `/act_${accountId}/insights`,
      {
        level: 'campaign',
        time_increment: '1',
        time_range: JSON.stringify({ since: startDate, until: endDate }),
        fields:
          'campaign_id,date_start,spend,inline_link_clicks,impressions,reach,frequency,cpm,inline_link_click_ctr,actions',
        filtering: JSON.stringify([
          { field: 'campaign.id', operator: 'IN', value: ids },
        ]),
        limit: '500',
      },
    );

    const insights: MetaDailyInsight[] = [];
    for (const row of rows) {
      const id = asString(row.campaign_id);
      const date = asString(row.date_start);
      if (!id || !date) continue;
      const actions: Record<string, number> = {};
      for (const action of Array.isArray(row.actions) ? row.actions : []) {
        if (!isRecord(action)) continue;
        const type = asString(action.action_type);
        const value = asNumber(action.value);
        if (type && value !== null) actions[type] = value;
      }
      insights.push({
        date,
        externalCampaignId: id,
        spend: asNumber(row.spend) ?? 0,
        linkClicks: Math.trunc(asNumber(row.inline_link_clicks) ?? 0),
        impressions: Math.trunc(asNumber(row.impressions) ?? 0),
        reach: optionalInt(row.reach),
        frequency: asNumber(row.frequency),
        cpm: asNumber(row.cpm),
        ctr: asNumber(row.inline_link_click_ctr),
        actions,
        raw: row,
      });
    }
    return insights;
  }

  async setCampaignStatus(
    accessToken: string,
    externalCampaignId: string,
    status: MetaCampaignStatus,
  ): Promise<void> {
    assertDigits(externalCampaignId);
    await this.graph('POST', `/${externalCampaignId}`, accessToken, { status });
  }

  isUnauthorizedError(error: unknown): boolean {
    return error instanceof UnauthorizedException;
  }

  /** Follows the "after" cursor, never a server-supplied URL. */
  private async paginate(
    accessToken: string,
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const body: { data?: unknown; paging?: unknown } = await this.graph(
        'GET',
        path,
        accessToken,
        after ? { ...params, after } : params,
      );
      if (Array.isArray(body.data)) rows.push(...body.data.filter(isRecord));
      const paging = isRecord(body.paging) ? body.paging : {};
      const cursors = isRecord(paging.cursors) ? paging.cursors : {};
      after = paging.next ? asString(cursors.after) : null;
      if (!after) return rows;
    }
    this.logger.warn(`Meta Ads ${path}: stopped after ${MAX_PAGES} pages`);
    return rows;
  }

  private async graph<T>(
    method: 'GET' | 'POST',
    path: string,
    accessToken: string,
    params: Record<string, string>,
  ): Promise<T> {
    this.assertConfigured();
    const all = new URLSearchParams({
      ...params,
      access_token: accessToken,
      appsecret_proof: createHmac('sha256', this.appSecret())
        .update(accessToken)
        .digest('hex'),
    });
    const url = `${GRAPH_ORIGIN}/${this.version()}${path}`;
    const response =
      method === 'GET'
        ? await this.fetchWithTimeout(`${url}?${all.toString()}`, {
            method,
            headers: { Accept: 'application/json' },
          })
        : await this.fetchWithTimeout(url, {
            method,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: all.toString(),
          });
    const parsed = await readJson(response);
    if (response.ok) return (isRecord(parsed) ? parsed : {}) as T;
    throw this.toHttpException(graphError(parsed, response.status));
  }

  private async tokenRequest(
    params: Record<string, string>,
  ): Promise<MetaTokenSet> {
    const response = await this.fetchWithTimeout(
      `${GRAPH_ORIGIN}/${this.version()}/oauth/access_token?${new URLSearchParams(params).toString()}`,
      { method: 'GET', headers: { Accept: 'application/json' } },
    );
    const body = await readJson(response);
    if (!response.ok || !isRecord(body)) {
      const error = graphError(body, response.status);
      // 101: wrong app id/secret. Server-side problem — never flag merchants for reauth.
      if (
        error.code === 101 ||
        /client secret|client id/i.test(error.message)
      ) {
        this.logger.error(
          `Meta rejected the app credentials: ${error.message}`,
        );
        throw new ServiceUnavailableException(
          'Meta Ads sign-in is misconfigured on the server',
        );
      }
      if (error.code === 100 || error.code === 190) {
        throw new UnauthorizedException(
          'Meta authorization is no longer valid',
        );
      }
      throw this.toHttpException(error);
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

  private toHttpException(error: MetaAdsGraphError) {
    const code = error.code;
    if (
      error.httpStatus === 401 ||
      (code !== null && AUTH_ERROR_CODES.has(code))
    ) {
      return new UnauthorizedException(
        'Meta Ads access is no longer authorized',
      );
    }
    if (
      error.httpStatus === 429 ||
      error.httpStatus >= 500 ||
      (code !== null &&
        (TRANSIENT_ERROR_CODES.has(code) || (code >= 80000 && code <= 80014)))
    ) {
      return new ServiceUnavailableException(
        'Meta Ads API is temporarily unavailable',
      );
    }
    if (
      code !== null &&
      (PERMISSION_ERROR_CODES.has(code) || (code > 200 && code < 300))
    ) {
      return new ForbiddenException(`Meta Ads: ${error.message}`);
    }
    return new BadGatewayException(`Meta Ads: ${error.message}`);
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(this.configService.get<string>('META_ADS_HTTP_TIMEOUT_MS')) ||
        DEFAULT_TIMEOUT_MS,
    );
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new ServiceUnavailableException('Unable to reach Meta');
    } finally {
      clearTimeout(timeout);
    }
  }

  private version(): string {
    return (
      this.configService.get<string>('META_ADS_API_VERSION')?.trim() ||
      DEFAULT_API_VERSION
    );
  }

  /** Meta Ads may run on its own app or share the WhatsApp one. */
  private appId(): string {
    return (
      this.configService.get<string>('META_ADS_APP_ID')?.trim() ||
      this.required('META_APP_ID')
    );
  }

  private appSecret(): string {
    return (
      this.configService.get<string>('META_ADS_APP_SECRET')?.trim() ||
      this.required('META_APP_SECRET')
    );
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${key} is not configured`);
    }
    return value;
  }
}

function graphError(body: unknown, httpStatus: number): MetaAdsGraphError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : {};
  return new MetaAdsGraphError(
    asString(error.error_user_msg) ??
      asString(error.message) ??
      'Meta Ads API request failed',
    httpStatus,
    asNumber(error.code),
    asNumber(error.error_subcode),
  );
}

/** Smallest-unit factor for a currency (100 for MAD/USD/EUR, 1 for JPY). */
function minorUnitFactor(currency: string | null): number {
  if (!currency) return 100;
  try {
    const digits = new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return 10 ** (digits ?? 2);
  } catch {
    return 100;
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function assertDigits(value: string): void {
  if (!/^\d+$/.test(value)) {
    throw new BadGatewayException('Invalid Meta Ads id');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  const num = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof num === 'number' && Number.isFinite(num) ? num : null;
}

function optionalInt(value: unknown): number | null {
  const num = asNumber(value);
  return num !== null ? Math.trunc(num) : null;
}

function asDate(value: unknown): Date | null {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}
