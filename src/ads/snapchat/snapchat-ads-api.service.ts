import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { calendarDay, dateInZone } from '../../common/calendar-date.util';

const API = 'https://adsapi.snapchat.com';
const TOKEN = 'https://accounts.snapchat.com/login/oauth2/access_token';
export const SNAPCHAT_SCOPE = 'snapchat-marketing-api';
export interface SnapchatTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
}
export interface SnapchatAccount {
  id: string;
  name: string | null;
  currency: string;
  timezone: string;
}
export interface SnapchatCampaign {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  budget: string | null;
  startDate: Date | null;
  endDate: Date | null;
}
export interface SnapchatMetric {
  campaignId: string;
  date: string;
  spend: string;
  clicks: number;
  impressions: number;
  purchases: number;
  reach: number | null;
  frequency: string | null;
  raw: Prisma.InputJsonObject;
}

@Injectable()
export class SnapchatAdsApiService {
  constructor(private readonly config: ConfigService) {}
  isEnabled() {
    return this.config.get<string>('SNAPCHAT_ADS_ENABLED') === 'true';
  }
  assertConfigured() {
    if (!this.isEnabled())
      throw new ServiceUnavailableException('Snapchat Ads is not enabled');
    for (const key of [
      'SNAPCHAT_ADS_CLIENT_ID',
      'SNAPCHAT_ADS_CLIENT_SECRET',
      'SNAPCHAT_ADS_REDIRECT_URI',
    ])
      this.required(key);
  }
  authorizationUrl(state: string) {
    this.assertConfigured();
    const url = new URL('https://accounts.snapchat.com/login/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: this.required('SNAPCHAT_ADS_CLIENT_ID'),
      redirect_uri: this.required('SNAPCHAT_ADS_REDIRECT_URI'),
      response_type: 'code',
      scope: SNAPCHAT_SCOPE,
      state,
    }).toString();
    return url.toString();
  }
  exchange(code: string) {
    return this.token({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.required('SNAPCHAT_ADS_REDIRECT_URI'),
    });
  }
  refresh(refreshToken: string) {
    return this.token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
  }

  async accounts(accessToken: string): Promise<SnapchatAccount[]> {
    const organizations = await this.pages(
      '/v1/me/organizations?with_ad_accounts=true',
      accessToken,
      'organizations',
      'organization',
    );
    const accounts = new Map<string, SnapchatAccount>();
    for (const org of organizations) {
      if (org.ad_accounts == null) continue;
      if (!Array.isArray(org.ad_accounts))
        throw new BadGatewayException(
          'Snapchat did not return the authorized ad accounts',
        );
      for (const value of org.ad_accounts) {
        if (!record(value))
          throw new BadGatewayException('Invalid Snapchat ad account');
        if (value.status !== 'ACTIVE') continue;
        const id = text(value.id),
          currency = text(value.currency)?.toUpperCase(),
          timezone = text(value.timezone);
        if (
          !id ||
          !isSnapId(id) ||
          !currency ||
          !/^[A-Z]{3}$/.test(currency) ||
          !timezone
        ) {
          throw new BadGatewayException(
            'Snapchat ad account currency/timezone is unavailable',
          );
        }
        try {
          new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
        } catch {
          throw new BadGatewayException(
            'Snapchat returned an invalid ad account timezone',
          );
        }
        accounts.set(id, { id, name: text(value.name), currency, timezone });
      }
    }
    return [...accounts.values()];
  }

  async campaigns(
    token: string,
    accountId: string,
  ): Promise<SnapchatCampaign[]> {
    assertId(accountId);
    const rows = await this.pages(
      `/v1/adaccounts/${accountId}/campaigns?limit=100`,
      token,
      'campaigns',
      'campaign',
    );
    return rows
      .filter((row) => row.deleted !== true)
      .map((row) => {
        const id = text(row.id),
          name = text(row.name),
          status = text(row.status);
        if (!id || !isSnapId(id) || !name || !status)
          throw new BadGatewayException('Invalid Snapchat campaign');
        const objectiveV2 = record(row.objective_v2_properties)
          ? text(row.objective_v2_properties.objective_v2_type)
          : null;
        return {
          id,
          name,
          status,
          objective: objectiveV2 ?? text(row.objective),
          budget:
            row.daily_budget_micro == null
              ? null
              : micros(row.daily_budget_micro),
          startDate: optionalDate(row.start_time),
          endDate: optionalDate(row.end_time),
        };
      });
  }

  /** DAY reports use ad-account midnight boundaries; synchronous windows <=31 days. */
  async dailyMetrics(
    token: string,
    accountId: string,
    timezone: string,
    from: string,
    toExclusive: string,
  ): Promise<SnapchatMetric[]> {
    assertId(accountId);
    const start = dateInZone(from, timezone),
      end = dateInZone(toExclusive, timezone);
    if (
      from >= toExclusive ||
      (new Date(toExclusive).getTime() - new Date(from).getTime()) / 86400000 >
        31
    ) {
      throw new BadGatewayException('Invalid Snapchat reporting window');
    }
    const query = new URLSearchParams({
      granularity: 'DAY',
      breakdown: 'campaign',
      fields: 'spend,swipes,impressions,conversion_purchases,uniques,frequency',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      omit_empty: 'false',
      action_report_time: 'conversion',
      swipe_up_attribution_window: '28_DAY',
      view_attribution_window: '1_DAY',
    });
    const reports = await this.pages(
      `/v1/adaccounts/${accountId}/stats?${query}`,
      token,
      'timeseries_stats',
      'timeseries_stat',
    );
    const result: SnapchatMetric[] = [];
    for (const report of reports) {
      const breakdown = record(report.breakdown_stats)
        ? report.breakdown_stats
        : null;
      if (!breakdown || !Array.isArray(breakdown.campaign))
        throw new BadGatewayException(
          'Snapchat campaign breakdown is unavailable',
        );
      for (const campaign of breakdown.campaign) {
        if (
          !record(campaign) ||
          !isSnapId(text(campaign.id) ?? '') ||
          !Array.isArray(campaign.timeseries)
        )
          throw new BadGatewayException('Invalid Snapchat campaign metrics');
        for (const day of campaign.timeseries) {
          if (!record(day) || !record(day.stats))
            throw new BadGatewayException('Invalid Snapchat daily metrics');
          const instant = optionalDate(day.start_time);
          if (!instant)
            throw new BadGatewayException(
              'Snapchat metric date is unavailable',
            );
          const date = calendarDay(instant, timezone)
            .toISOString()
            .slice(0, 10);
          if (date < from || date >= toExclusive)
            throw new BadGatewayException(
              'Snapchat returned metrics outside the reporting window',
            );
          const stats = day.stats;
          // Missing required fields are unavailable data, not assumed zero.
          result.push({
            campaignId: String(campaign.id),
            date,
            spend: micros(stats.spend),
            clicks: count(stats.swipes),
            impressions: count(stats.impressions),
            purchases: count(stats.conversion_purchases),
            reach: stats.uniques == null ? null : count(stats.uniques),
            frequency:
              stats.frequency == null
                ? null
                : decimal(stats.frequency).toFixed(4),
            raw: {
              resultMetric: 'conversion_purchases',
              actionReportTime: 'conversion',
              swipeAttribution: '28_DAY',
              viewAttribution: '1_DAY',
              stats: stats as Prisma.InputJsonObject,
            },
          });
        }
      }
    }
    return result;
  }

  private async token(params: Record<string, string>): Promise<SnapchatTokens> {
    this.assertConfigured();
    const response = await this.fetch(TOKEN, {
      redirect: 'error',
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...params,
        client_id: this.required('SNAPCHAT_ADS_CLIENT_ID'),
        client_secret: this.required('SNAPCHAT_ADS_CLIENT_SECRET'),
      }).toString(),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = record(body) ? text(body.error) : null;
      if (error === 'invalid_grant' || error === 'access_denied')
        throw new UnauthorizedException(
          'Snapchat authorization expired or was revoked',
        );
      if (error === 'invalid_client' || error === 'unauthorized_client')
        throw new ServiceUnavailableException(
          'Snapchat OAuth credentials are misconfigured',
        );
      throw new ServiceUnavailableException(
        'Snapchat sign-in is temporarily unavailable',
      );
    }
    if (
      !record(body) ||
      !text(body.access_token) ||
      typeof body.expires_in !== 'number' ||
      body.expires_in <= 0
    )
      throw new BadGatewayException('Invalid Snapchat token response');
    return {
      accessToken: String(body.access_token),
      refreshToken: text(body.refresh_token),
      expiresAt: new Date(Date.now() + body.expires_in * 1000),
      // Snap's documented code-exchange example omits scope; the request has one fixed scope.
      scopes: text(body.scope)?.split(/\s+/) ?? [SNAPCHAT_SCOPE],
    };
  }

  private async pages(
    path: string,
    token: string,
    collection: string,
    entity: string,
  ): Promise<Record<string, unknown>[]> {
    this.assertConfigured();
    const rows: Record<string, unknown>[] = [],
      visited = new Set<string>();
    let next: string | null = new URL(path, API).toString();
    const collectionPath = new URL(path, API).pathname;
    for (let page = 0; next; page++) {
      const target: URL = new URL(next);
      if (
        target.origin !== API ||
        target.pathname !== collectionPath ||
        target.username ||
        target.password ||
        visited.has(next) ||
        page >= 100
      ) {
        throw new BadGatewayException('Invalid Snapchat pagination link');
      }
      visited.add(next);
      const response = await this.fetch(next, {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
      });
      if (response.status === 401)
        throw new UnauthorizedException('Reconnect Snapchat Ads');
      if (response.status === 403)
        throw new ForbiddenException(
          'Snapchat denied access to this ad account',
        );
      if (response.status === 429 || response.status >= 500)
        throw new ServiceUnavailableException(
          'Snapchat Ads is temporarily unavailable',
        );
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        !record(body) ||
        !success(body.request_status) ||
        !Array.isArray(body[collection])
      )
        throw new BadGatewayException('Invalid Snapchat API response');
      for (const item of body[collection]) {
        if (
          !record(item) ||
          !success(item.sub_request_status) ||
          !record(item[entity])
        )
          throw new BadGatewayException(
            'Snapchat returned a partial or failed response',
          );
        rows.push(item[entity]);
      }
      next = record(body.paging) ? text(body.paging.next_link) : null;
      if (next) next = new URL(next, API).toString();
    }
    return rows;
  }
  private fetch(url: string, options: RequestInit) {
    const timeout =
      Number(this.config.get<string>('SNAPCHAT_ADS_HTTP_TIMEOUT_MS')) || 20000;
    return fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeout),
    }).catch(() => {
      throw new ServiceUnavailableException('Unable to reach Snapchat');
    });
  }
  private required(name: string) {
    const value = this.config.get<string>(name)?.trim();
    if (!value)
      throw new ServiceUnavailableException(`${name} is not configured`);
    return value;
  }
}
export function isSnapId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
function assertId(value: string) {
  if (!isSnapId(value))
    throw new BadGatewayException('Invalid Snapchat identifier');
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function success(value: unknown) {
  return typeof value === 'string' && value.toUpperCase() === 'SUCCESS';
}
function decimal(value: unknown) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'number' &&
      !Number.isSafeInteger(value) &&
      !String(value).includes('.'))
  )
    throw new BadGatewayException('Invalid Snapchat numeric value');
  let result: Prisma.Decimal;
  try {
    result = new Prisma.Decimal(value);
  } catch {
    throw new BadGatewayException('Invalid Snapchat numeric value');
  }
  if (!result.isFinite() || result.isNegative())
    throw new BadGatewayException('Invalid Snapchat numeric value');
  return result;
}
function micros(value: unknown) {
  return decimal(value).div(1000000).toFixed(6);
}
function count(value: unknown) {
  const result = decimal(value);
  if (!result.isInteger() || result.gt(2147483647))
    throw new BadGatewayException('Snapchat count exceeds supported range');
  return result.toNumber();
}
function optionalDate(value: unknown) {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new BadGatewayException('Invalid Snapchat date');
  return new Date(value);
}
