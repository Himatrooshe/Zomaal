import {
  BadRequestException,
  ConflictException,
  Injectable,
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
} from '../ads-token-encryption.service';
import {
  AdsConnectionService,
  toConnectionSummary,
} from '../ads-connection.service';
import { StoreAccessService } from '../../access/store-access.service';
import {
  META_ADS_READ_PERMISSION,
  MetaAdsApiService,
} from './meta-ads-api.service';

const RECONNECT_MESSAGE = 'Reconnect Meta Ads before using this feature';

@Injectable()
export class MetaAdsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly metaApi: MetaAdsApiService,
    private readonly tokenEncryption: AdsTokenEncryptionService,
    private readonly connections: AdsConnectionService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async begin(userId: string) {
    this.metaApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.storeAccess.requireStore(userId);
    const state = randomBytes(32).toString('base64url');
    const ttlSeconds =
      Number(
        this.configService.get<string>('META_ADS_OAUTH_STATE_TTL_SECONDS'),
      ) || 600;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.$transaction([
      this.prisma.adsOAuthState.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            { storeId: store.id, platform: AdsPlatform.META },
          ],
        },
      }),
      this.prisma.adsOAuthState.create({
        data: {
          stateHash: hashState(state),
          platform: AdsPlatform.META,
          expiresAt,
          userId,
          storeId: store.id,
        },
      }),
    ]);

    return {
      authorizationUrl: this.metaApi.buildAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(rawQuery: Record<string, unknown>) {
    const query = normalizeQuery(rawQuery);
    if (!query.state) {
      throw new BadRequestException('Meta OAuth callback is missing state');
    }

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.adsOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState || oauthState.platform !== AdsPlatform.META) {
      throw new UnauthorizedException(
        'Meta OAuth state is invalid or has already been used',
      );
    }
    const consumed = await this.prisma.adsOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'Meta OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Meta OAuth state has expired');
    }

    if (query.error) {
      throw new UnauthorizedException(
        'Meta authorization was canceled or rejected',
      );
    }
    if (!query.code) {
      throw new BadRequestException('Meta OAuth callback is missing code');
    }

    const tokens = await this.metaApi.exchangeAuthorizationCode(query.code);
    const granted = await this.metaApi.getGrantedPermissions(
      tokens.accessToken,
    );
    if (!granted.includes(META_ADS_READ_PERMISSION)) {
      throw new BadRequestException(
        'Access to your ads was not granted. Connect again and allow Zomaal to read your ad accounts.',
      );
    }

    const accounts = await this.metaApi.listAdAccounts(tokens.accessToken);
    if (accounts.length === 0) {
      throw new BadRequestException(
        'No active Meta ad account was found for this Facebook user. ' +
          'Check that you have access to the ad account in Meta Business Suite and that it is not disabled or closed.',
      );
    }

    const connections: ReturnType<typeof toConnectionSummary>[] = [];
    for (const account of accounts) {
      const id = account.accountId;
      const data = {
        status: AdsConnectionStatus.ACTIVE,
        displayName: account.name,
        currency: account.currency,
        timezone: account.timezone,
        encryptedAccessToken: this.tokenEncryption.encrypt(
          tokens.accessToken,
          adsAccessTokenContext(AdsPlatform.META, id),
        ),
        encryptedRefreshToken: null,
        accessTokenExpiresAt: tokens.expiresAt,
        grantedScopes: granted.join(','),
        lastVerifiedAt: new Date(),
      };
      const connection = await this.prisma.adsConnection.upsert({
        where: {
          storeId_platform_externalAdvertiserId: {
            storeId: oauthState.storeId,
            platform: AdsPlatform.META,
            externalAdvertiserId: id,
          },
        },
        create: {
          storeId: oauthState.storeId,
          platform: AdsPlatform.META,
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
   * The stored token. Meta can't refresh it, so once it has expired the
   * connection is flagged REAUTHORIZATION_REQUIRED and the merchant reconnects.
   */
  async getValidAccessToken(connection: AdsConnection): Promise<string> {
    if (
      connection.status !== AdsConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(RECONNECT_MESSAGE);
    }
    if (
      connection.accessTokenExpiresAt &&
      connection.accessTokenExpiresAt.getTime() <= Date.now()
    ) {
      await this.connections.markReauthorizationRequired(connection.id);
      throw new ConflictException(RECONNECT_MESSAGE);
    }
    return this.tokenEncryption.decrypt(
      connection.encryptedAccessToken,
      adsAccessTokenContext(AdsPlatform.META, connection.externalAdvertiserId),
    );
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl('META_ADS_AUTH_SUCCESS_REDIRECT_URL', 'connected');
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('META_ADS_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) return null;
    const url = new URL(configured);
    url.searchParams.set('meta_ads', status);
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
        `Invalid Meta OAuth query parameter: ${key}`,
      );
    }
  }
  return query;
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}
