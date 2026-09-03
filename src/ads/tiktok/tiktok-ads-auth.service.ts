import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdsConnectionStatus, AdsPlatform } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsTokenEncryptionService, adsAccessTokenContext } from '../ads-token-encryption.service';
import { toConnectionSummary } from '../ads-connection.service';
import { TikTokAdsApiService } from './tiktok-ads-api.service';

@Injectable()
export class TikTokAdsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly tiktokApi: TikTokAdsApiService,
    private readonly tokenEncryption: AdsTokenEncryptionService,
  ) {}

  async begin(userId: string) {
    this.tiktokApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException(
        'Create your Zomaal store before connecting TikTok Ads',
      );
    }

    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    const expiresAt = new Date(
      Date.now() +
        this.configService.get<number>('TIKTOK_ADS_OAUTH_STATE_TTL_SECONDS', 600) *
          1000,
    );

    await this.prisma.$transaction([
      this.prisma.adsOAuthState.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            { storeId: store.id, platform: AdsPlatform.TIKTOK },
          ],
        },
      }),
      this.prisma.adsOAuthState.create({
        data: {
          stateHash,
          platform: AdsPlatform.TIKTOK,
          expiresAt,
          userId,
          storeId: store.id,
        },
      }),
    ]);

    return {
      authorizationUrl: this.tiktokApi.buildAuthorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(rawQuery: Record<string, unknown>) {
    const query = normalizeQuery(rawQuery);
    if (!query.state) {
      throw new BadRequestException('TikTok OAuth callback is missing state');
    }

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.adsOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState || oauthState.platform !== AdsPlatform.TIKTOK) {
      throw new UnauthorizedException(
        'TikTok OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      await this.prisma.adsOAuthState.deleteMany({ where: { stateHash } });
      throw new UnauthorizedException('TikTok OAuth state has expired');
    }
    const consumed = await this.prisma.adsOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'TikTok OAuth state is invalid or has already been used',
      );
    }

    if (query.error) {
      throw new UnauthorizedException(
        'TikTok authorization was canceled or rejected',
      );
    }
    if (!query.auth_code && !query.code) {
      throw new BadRequestException('TikTok OAuth callback is missing auth_code');
    }

    const tokens = await this.tiktokApi.exchangeAuthorizationCode(
      query.auth_code ?? query.code,
    );

    // oauth2/advertiser/get/ is the authoritative source for which
    // advertiser accounts this token was actually granted — the token
    // exchange response's own advertiser_ids isn't reliably populated on
    // every app configuration, so it's only a fallback here.
    let advertiserIds = await this.tiktokApi.getAuthorizedAdvertiserIds(
      tokens.accessToken,
    );
    if (advertiserIds.length === 0) {
      advertiserIds = tokens.advertiserIds;
    }
    if (advertiserIds.length === 0) {
      throw new BadRequestException(
        'TikTok did not grant access to any advertiser account',
      );
    }

    const advertiserDetails = await this.tiktokApi.getAdvertiserDetails(
      tokens.accessToken,
      advertiserIds,
    );
    const detailsById = new Map(
      advertiserDetails.map((detail) => [detail.advertiserId, detail]),
    );

    const connections: ReturnType<typeof toConnectionSummary>[] = [];
    for (const advertiserId of advertiserIds) {
      const details = detailsById.get(advertiserId);
      const encryptedAccessToken = this.tokenEncryption.encrypt(
        tokens.accessToken,
        adsAccessTokenContext(AdsPlatform.TIKTOK, advertiserId),
      );

      const connection = await this.prisma.adsConnection.upsert({
        where: {
          storeId_platform_externalAdvertiserId: {
            storeId: oauthState.storeId,
            platform: AdsPlatform.TIKTOK,
            externalAdvertiserId: advertiserId,
          },
        },
        create: {
          storeId: oauthState.storeId,
          platform: AdsPlatform.TIKTOK,
          status: AdsConnectionStatus.ACTIVE,
          externalAdvertiserId: advertiserId,
          displayName: details?.name ?? null,
          currency: details?.currency ?? null,
          timezone: details?.timezone ?? null,
          encryptedAccessToken,
          grantedScopes: tokens.scope.join(','),
          lastVerifiedAt: new Date(),
        },
        update: {
          status: AdsConnectionStatus.ACTIVE,
          displayName: details?.name ?? null,
          currency: details?.currency ?? null,
          timezone: details?.timezone ?? null,
          encryptedAccessToken,
          grantedScopes: tokens.scope.join(','),
          disconnectedAt: null,
          lastVerifiedAt: new Date(),
        },
      });
      connections.push(toConnectionSummary(connection));
    }

    return { connections };
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl('TIKTOK_ADS_AUTH_SUCCESS_REDIRECT_URL', 'connected');
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('TIKTOK_ADS_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) {
      return null;
    }
    const url = new URL(configured);
    url.searchParams.set('tiktok_ads', status);
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
      throw new BadRequestException(`Invalid TikTok OAuth query parameter: ${key}`);
    }
  }
  return query;
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}
