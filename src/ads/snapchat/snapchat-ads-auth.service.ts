import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AdsConnection,
  AdsConnectionStatus,
  AdsPlatform,
} from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreAccessService } from '../../access/store-access.service';
import { PERMISSIONS } from '../../access/permissions';
import {
  AdsTokenEncryptionService,
  adsAccessTokenContext,
  adsRefreshTokenContext,
} from '../ads-token-encryption.service';
import { toConnectionSummary } from '../ads-connection.service';
import {
  SNAPCHAT_SCOPE,
  SnapchatAdsApiService,
} from './snapchat-ads-api.service';

const PLATFORM = AdsPlatform.SNAPCHAT;
@Injectable()
export class SnapchatAdsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly api: SnapchatAdsApiService,
    private readonly encryption: AdsTokenEncryptionService,
    private readonly access: StoreAccessService,
  ) {}

  async begin(userId: string) {
    this.api.assertConfigured();
    this.encryption.assertConfigured();
    const access = await this.access.require(userId);
    if (!access.isOwner && !access.permissions.includes(PERMISSIONS.ADS_MANAGE))
      throw new ForbiddenException('Ads management permission is required');
    const state = randomBytes(32).toString('base64url');
    const ttl =
      Number(this.config.get<string>('SNAPCHAT_ADS_OAUTH_STATE_TTL_SECONDS')) ||
      600;
    const expiresAt = new Date(Date.now() + ttl * 1000);
    await this.prisma.$transaction([
      this.prisma.adsOAuthState.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            { storeId: access.storeId, platform: PLATFORM },
          ],
        },
      }),
      this.prisma.adsOAuthState.create({
        data: {
          stateHash: hash(state),
          platform: PLATFORM,
          userId,
          storeId: access.storeId,
          expiresAt,
        },
      }),
    ]);
    return {
      authorizationUrl: this.api.authorizationUrl(state),
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(query: Record<string, unknown>) {
    if (Object.values(query).some((value) => typeof value !== 'string'))
      throw new BadRequestException('Invalid Snapchat callback parameters');
    if (typeof query.state !== 'string' || !query.state)
      throw new BadRequestException('Snapchat callback is missing state');
    const stateHash = hash(query.state);
    const state = await this.prisma.adsOAuthState.findUnique({
      where: { stateHash },
    });
    if (!state || state.platform !== PLATFORM)
      throw new UnauthorizedException('Invalid or reused Snapchat OAuth state');
    const consumed = await this.prisma.adsOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1 || state.expiresAt <= new Date())
      throw new UnauthorizedException('Expired or reused Snapchat OAuth state');
    if (query.error)
      throw new UnauthorizedException(
        'Snapchat authorization was canceled or rejected',
      );
    if (typeof query.code !== 'string' || !query.code)
      throw new BadRequestException('Snapchat callback is missing code');
    // Re-check staff membership, active store, plan and subscription after consent.
    const access = await this.access.require(state.userId);
    if (
      access.storeId !== state.storeId ||
      (!access.isOwner && !access.permissions.includes(PERMISSIONS.ADS_MANAGE))
    ) {
      throw new ForbiddenException(
        'Store access changed during Snapchat authorization',
      );
    }
    const store = await this.prisma.store.findUnique({
      where: { id: state.storeId },
      select: {
        user: { select: { subscription: { include: { plan: true } } } },
      },
    });
    const subscription = store?.user.subscription;
    if (
      !subscription ||
      subscription.accessEndsAt <= new Date() ||
      (subscription.planId && !subscription.plan?.features.includes('ads'))
    ) {
      throw new ForbiddenException(
        'An active plan with ads access is required',
      );
    }
    const tokens = await this.api.exchange(query.code);
    if (!tokens.refreshToken || !tokens.scopes.includes(SNAPCHAT_SCOPE))
      throw new BadRequestException(
        'Snapchat did not grant renewable Marketing API access',
      );
    const accounts = await this.api.accounts(tokens.accessToken);
    if (!accounts.length)
      throw new BadRequestException(
        'No active Snapchat ad accounts are accessible to this Snapchat user',
      );
    const connections = await this.prisma.$transaction(
      accounts.map((account) => {
        const data = {
          status: AdsConnectionStatus.ACTIVE,
          displayName: account.name,
          currency: account.currency,
          timezone: account.timezone,
          encryptedAccessToken: this.encryption.encrypt(
            tokens.accessToken,
            adsAccessTokenContext(PLATFORM, account.id),
          ),
          encryptedRefreshToken: this.encryption.encrypt(
            tokens.refreshToken!,
            adsRefreshTokenContext(PLATFORM, account.id),
          ),
          accessTokenExpiresAt: tokens.expiresAt,
          grantedScopes: tokens.scopes.join(','),
          lastVerifiedAt: new Date(),
          disconnectedAt: null,
          lastSyncError: null,
        };
        return this.prisma.adsConnection.upsert({
          where: {
            storeId_platform_externalAdvertiserId: {
              storeId: state.storeId,
              platform: PLATFORM,
              externalAdvertiserId: account.id,
            },
          },
          create: {
            storeId: state.storeId,
            platform: PLATFORM,
            externalAdvertiserId: account.id,
            ...data,
          },
          update: data,
        });
      }),
    );
    return { connections: connections.map(toConnectionSummary) };
  }

  /** Row lock serializes refresh-token rotation across requests and instances. */
  async getValidAccessToken(connection: AdsConnection): Promise<string> {
    const token = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "AdsConnection" WHERE "id" = ${connection.id} FOR UPDATE`;
        const current = await tx.adsConnection.findUnique({
          where: { id: connection.id },
        });
        if (
          !current ||
          current.platform !== PLATFORM ||
          current.status !== AdsConnectionStatus.ACTIVE ||
          !current.encryptedAccessToken
        )
          return null;
        const accessContext = adsAccessTokenContext(
          PLATFORM,
          current.externalAdvertiserId,
        );
        if (
          current.accessTokenExpiresAt &&
          current.accessTokenExpiresAt.getTime() > Date.now() + 120000
        )
          return this.encryption.decrypt(
            current.encryptedAccessToken,
            accessContext,
          );
        const refreshContext = adsRefreshTokenContext(
          PLATFORM,
          current.externalAdvertiserId,
        );
        try {
          if (!current.encryptedRefreshToken) throw new UnauthorizedException();
          const refreshed = await this.api.refresh(
            this.encryption.decrypt(
              current.encryptedRefreshToken,
              refreshContext,
            ),
          );
          if (!refreshed.scopes.includes(SNAPCHAT_SCOPE))
            throw new UnauthorizedException();
          await tx.adsConnection.update({
            where: { id: current.id },
            data: {
              encryptedAccessToken: this.encryption.encrypt(
                refreshed.accessToken,
                accessContext,
              ),
              ...(refreshed.refreshToken
                ? {
                    encryptedRefreshToken: this.encryption.encrypt(
                      refreshed.refreshToken,
                      refreshContext,
                    ),
                  }
                : {}),
              accessTokenExpiresAt: refreshed.expiresAt,
            },
          });
          return refreshed.accessToken;
        } catch (error) {
          if (!(error instanceof UnauthorizedException)) throw error;
          await tx.adsConnection.update({
            where: { id: current.id },
            data: {
              status: AdsConnectionStatus.REAUTHORIZATION_REQUIRED,
              encryptedAccessToken: null,
              encryptedRefreshToken: null,
              accessTokenExpiresAt: null,
            },
          });
          return null; // Commit revocation before returning the HTTP conflict.
        }
      },
      { timeout: 60000 },
    );
    if (!token) throw new ConflictException('Reconnect Snapchat Ads');
    return token;
  }
  redirect(outcome: 'connected' | 'failed') {
    const value = this.config.get<string>(
      outcome === 'connected'
        ? 'SNAPCHAT_ADS_AUTH_SUCCESS_REDIRECT_URL'
        : 'SNAPCHAT_ADS_AUTH_FAILURE_REDIRECT_URL',
    );
    if (!value) return null;
    const url = new URL(value);
    url.searchParams.set('snapchat_ads', outcome);
    return url.toString();
  }
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
