import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdsConnection,
  AdsConnectionStatus,
  AdsPlatform,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdsTokenEncryptionService,
  adsAccessTokenContext,
  adsRefreshTokenContext,
} from '../ads-token-encryption.service';
import {
  AdsConnectionService,
  toConnectionSummary,
} from '../ads-connection.service';
import { StoreAccessService } from '../../access/store-access.service';
import {
  GOOGLE_ADS_SCOPE,
  GoogleAdsApiService,
  type GoogleAdsCustomer,
} from './google-ads-api.service';

// Refresh a little before Google's ~1h expiry so a token never dies mid-call.
const REFRESH_SKEW_MS = 2 * 60 * 1000;

@Injectable()
export class GoogleAdsAuthService {
  private readonly logger = new Logger(GoogleAdsAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly googleApi: GoogleAdsApiService,
    private readonly tokenEncryption: AdsTokenEncryptionService,
    private readonly connections: AdsConnectionService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async begin(userId: string) {
    this.googleApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.storeAccess.requireStore(userId);
    const state = randomBytes(32).toString('base64url');
    const ttlSeconds =
      Number(
        this.configService.get<string>('GOOGLE_ADS_OAUTH_STATE_TTL_SECONDS'),
      ) || 600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.$transaction([
      this.prisma.adsOAuthState.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            { storeId: store.id, platform: AdsPlatform.GOOGLE },
          ],
        },
      }),
      this.prisma.adsOAuthState.create({
        data: {
          stateHash: hashState(state),
          platform: AdsPlatform.GOOGLE,
          expiresAt,
          userId,
          storeId: store.id,
        },
      }),
    ]);

    return {
      authorizationUrl: this.googleApi.buildAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(rawQuery: Record<string, unknown>) {
    const query = normalizeQuery(rawQuery);
    if (!query.state) {
      throw new BadRequestException('Google OAuth callback is missing state');
    }

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.adsOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState || oauthState.platform !== AdsPlatform.GOOGLE) {
      throw new UnauthorizedException(
        'Google OAuth state is invalid or has already been used',
      );
    }
    const consumed = await this.prisma.adsOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'Google OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Google OAuth state has expired');
    }

    if (query.error) {
      throw new UnauthorizedException(
        'Google authorization was canceled or rejected',
      );
    }
    if (!query.code) {
      throw new BadRequestException('Google OAuth callback is missing code');
    }

    const tokens = await this.googleApi.exchangeAuthorizationCode(query.code);
    if (!tokens.scope.includes(GOOGLE_ADS_SCOPE)) {
      throw new BadRequestException(
        'Google Ads access was not granted. Connect again and allow access to Google Ads.',
      );
    }
    if (!tokens.refreshToken) {
      throw new BadRequestException(
        'Google did not grant offline access. Connect again and approve all requested access.',
      );
    }

    const customers = await this.loadAdvertiserAccounts(tokens.accessToken);
    if (customers.length === 0) {
      throw new BadRequestException(
        'No active Google Ads advertiser account was found for this Google user. ' +
          'Manager (MCC) accounts are not supported yet — connect with a user that has direct access to the ad account.',
      );
    }

    const connections: ReturnType<typeof toConnectionSummary>[] = [];
    for (const customer of customers) {
      const id = customer.customerId;
      const data = {
        status: AdsConnectionStatus.ACTIVE,
        displayName: customer.name,
        currency: customer.currency,
        timezone: customer.timezone,
        encryptedAccessToken: this.tokenEncryption.encrypt(
          tokens.accessToken,
          adsAccessTokenContext(AdsPlatform.GOOGLE, id),
        ),
        encryptedRefreshToken: this.tokenEncryption.encrypt(
          tokens.refreshToken,
          adsRefreshTokenContext(AdsPlatform.GOOGLE, id),
        ),
        accessTokenExpiresAt: tokens.expiresAt,
        grantedScopes: tokens.scope.join(','),
        lastVerifiedAt: new Date(),
      };
      const connection = await this.prisma.adsConnection.upsert({
        where: {
          storeId_platform_externalAdvertiserId: {
            storeId: oauthState.storeId,
            platform: AdsPlatform.GOOGLE,
            externalAdvertiserId: id,
          },
        },
        create: {
          storeId: oauthState.storeId,
          platform: AdsPlatform.GOOGLE,
          externalAdvertiserId: id,
          ...data,
        },
        update: { ...data, disconnectedAt: null, lastSyncError: null },
      });
      connections.push(toConnectionSummary(connection));
    }

    return { connections };
  }

  /**
   * A usable access token, refreshing (and persisting) it when it is about
   * to expire. A revoked grant marks the connection REAUTHORIZATION_REQUIRED.
   */
  async getValidAccessToken(connection: AdsConnection): Promise<string> {
    if (connection.status !== AdsConnectionStatus.ACTIVE) {
      throw new ConflictException(
        'Reconnect Google Ads before using this feature',
      );
    }
    const id = connection.externalAdvertiserId;
    const fresh =
      connection.encryptedAccessToken &&
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() - REFRESH_SKEW_MS > Date.now();
    if (fresh) {
      return this.tokenEncryption.decrypt(
        connection.encryptedAccessToken!,
        adsAccessTokenContext(AdsPlatform.GOOGLE, id),
      );
    }

    if (!connection.encryptedRefreshToken) {
      await this.connections.markReauthorizationRequired(connection.id);
      throw new ConflictException(
        'Reconnect Google Ads before using this feature',
      );
    }
    const refreshToken = this.tokenEncryption.decrypt(
      connection.encryptedRefreshToken,
      adsRefreshTokenContext(AdsPlatform.GOOGLE, id),
    );

    try {
      const tokens = await this.googleApi.refreshAccessToken(refreshToken);
      await this.prisma.adsConnection.update({
        where: { id: connection.id },
        data: {
          encryptedAccessToken: this.tokenEncryption.encrypt(
            tokens.accessToken,
            adsAccessTokenContext(AdsPlatform.GOOGLE, id),
          ),
          accessTokenExpiresAt: tokens.expiresAt,
        },
      });
      return tokens.accessToken;
    } catch (error) {
      if (this.googleApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
        throw new ConflictException(
          'Reconnect Google Ads before using this feature',
        );
      }
      throw error;
    }
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl(
      'GOOGLE_ADS_AUTH_SUCCESS_REDIRECT_URL',
      'connected',
    );
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('GOOGLE_ADS_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  /**
   * Advertiser (non-manager, enabled) accounts the user can reach directly.
   * One unreadable account (cancelled, suspended, no permission) must not
   * fail the whole connect.
   */
  private async loadAdvertiserAccounts(
    accessToken: string,
  ): Promise<GoogleAdsCustomer[]> {
    const ids = await this.googleApi.listAccessibleCustomerIds(accessToken);
    const accounts: GoogleAdsCustomer[] = [];
    let readable = 0;
    let lastError: Error | null = null;
    for (const id of ids) {
      try {
        const customer = await this.googleApi.getCustomer(accessToken, id);
        readable += 1;
        if (customer && !customer.isManager && customer.status === 'ENABLED') {
          accounts.push(customer);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.logger.warn(
          `Skipping Google Ads customer ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    // Every account failed the same way (e.g. developer token not approved
    // for production accounts) — surface Google's reason, not "none found".
    if (readable === 0 && lastError) throw lastError;
    return accounts;
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) return null;
    const url = new URL(configured);
    url.searchParams.set('google_ads', status);
    return url.toString();
  }
}

function normalizeQuery(
  rawQuery: Record<string, unknown>,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (typeof value === 'string') {
      query[key] = value;
    } else {
      throw new BadRequestException(
        `Invalid Google OAuth query parameter: ${key}`,
      );
    }
  }
  return query;
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}
