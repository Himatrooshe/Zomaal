import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EcommerceConnectionStatus,
  EcommercePlatform,
  Prisma,
  YouCanConnectionStatus,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { YouCanConnectionStatusDto } from './dto/youcan-response.dto';
import { YouCanApiService } from './youcan-api.service';
import { YouCanConnectionService } from './youcan-connection.service';
import {
  youCanAccessTokenContext,
  youCanRefreshTokenContext,
} from './youcan-token-context';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';

@Injectable()
export class YouCanAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly youCanApi: YouCanApiService,
    private readonly tokenEncryption: YouCanTokenEncryptionService,
    private readonly connectionService: YouCanConnectionService,
  ) {}

  async begin(userId: string) {
    this.youCanApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException(
        'Create your Zomaal store before connecting YouCan',
      );
    }

    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    const requestedScopes = this.youCanApi.getRequestedScopes();
    const expiresAt = new Date(
      Date.now() +
        this.configService.get<number>('YOUCAN_OAUTH_STATE_TTL_SECONDS', 600) *
          1000,
    );

    await this.prisma.$transaction([
      this.prisma.youCanOAuthState.deleteMany({
        where: {
          OR: [{ expiresAt: { lte: new Date() } }, { storeId: store.id }],
        },
      }),
      this.prisma.youCanOAuthState.create({
        data: {
          stateHash,
          requestedScopes: requestedScopes.join(','),
          expiresAt,
          userId,
          storeId: store.id,
        },
      }),
    ]);

    return {
      authorizationUrl: this.youCanApi.buildAuthorizationUrl(
        state,
        requestedScopes,
      ),
      requestedScopes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(
    rawQuery: Record<string, unknown>,
  ): Promise<YouCanConnectionStatusDto> {
    const query = normalizeQuery(rawQuery);
    if (!query.state) {
      throw new BadRequestException('YouCan OAuth callback is missing state');
    }

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.youCanOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState) {
      throw new UnauthorizedException(
        'YouCan OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      await this.prisma.youCanOAuthState.deleteMany({ where: { stateHash } });
      throw new UnauthorizedException('YouCan OAuth state has expired');
    }

    const consumed = await this.prisma.youCanOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'YouCan OAuth state is invalid or has already been used',
      );
    }

    if (query.error) {
      if (query.error === 'access_denied') {
        throw new UnauthorizedException(
          'YouCan authorization was canceled by the seller',
        );
      }
      throw new UnauthorizedException('YouCan authorization failed');
    }
    if (!query.code) {
      throw new BadRequestException('YouCan OAuth callback is missing code');
    }

    const tokens = await this.youCanApi.exchangeAuthorizationCode(query.code);
    const youCanStore = await this.youCanApi.getStoreDetails(
      tokens.accessToken,
    );

    const existingStore = await this.prisma.youCanConnection.findUnique({
      where: { externalStoreId: youCanStore.storeId },
      select: { storeId: true },
    });
    if (existingStore && existingStore.storeId !== oauthState.storeId) {
      throw new ConflictException(
        'This YouCan store is already connected to another Zomaal store',
      );
    }

    const encryptedAccessToken = this.tokenEncryption.encrypt(
      tokens.accessToken,
      youCanAccessTokenContext(youCanStore.storeId),
    );
    const encryptedRefreshToken = this.tokenEncryption.encrypt(
      tokens.refreshToken,
      youCanRefreshTokenContext(youCanStore.storeId),
    );
    const grantedScopes = normalizeScopes(oauthState.requestedScopes).join(',');
    const installedAt = new Date();

    try {
      await this.prisma.$transaction(async (transaction) => {
        const existingConnection =
          await transaction.ecommerceConnection.findUnique({
            where: {
              storeId_platform: {
                storeId: oauthState.storeId,
                platform: EcommercePlatform.YOUCAN,
              },
            },
          });
        const accountChanged =
          existingConnection !== null &&
          existingConnection.externalAccountId !== youCanStore.storeId;

        if (accountChanged) {
          await transaction.ecommerceOrder.deleteMany({
            where: { connectionId: existingConnection.id },
          });
        }

        const ecommerceConnection =
          await transaction.ecommerceConnection.upsert({
            where: {
              storeId_platform: {
                storeId: oauthState.storeId,
                platform: EcommercePlatform.YOUCAN,
              },
            },
            create: {
              storeId: oauthState.storeId,
              platform: EcommercePlatform.YOUCAN,
              externalAccountId: youCanStore.storeId,
              displayName: youCanStore.name ?? youCanStore.domain,
              status: EcommerceConnectionStatus.ACTIVE,
              includeInRevenue: false,
            },
            update: {
              externalAccountId: youCanStore.storeId,
              displayName: youCanStore.name ?? youCanStore.domain,
              status: EcommerceConnectionStatus.ACTIVE,
              includeInRevenue: false,
              ...(accountChanged
                ? {
                    syncCursor: null,
                    syncFrom: null,
                    syncStartedAt: null,
                    lastSyncedAt: null,
                    lastSyncError: null,
                  }
                : {}),
            },
          });

        await transaction.youCanConnection.upsert({
          where: { storeId: oauthState.storeId },
          create: {
            storeId: oauthState.storeId,
            ecommerceConnectionId: ecommerceConnection.id,
            externalStoreId: youCanStore.storeId,
            storeDomain: youCanStore.domain,
            displayName: youCanStore.name,
            currencyCode: youCanStore.currencyCode,
            status: YouCanConnectionStatus.ACTIVE,
            encryptedAccessToken,
            encryptedRefreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            tokenType: tokens.tokenType,
            grantedScopes,
            lastVerifiedAt: installedAt,
          },
          update: {
            ecommerceConnectionId: ecommerceConnection.id,
            externalStoreId: youCanStore.storeId,
            storeDomain: youCanStore.domain,
            displayName: youCanStore.name,
            currencyCode: youCanStore.currencyCode,
            status: YouCanConnectionStatus.ACTIVE,
            encryptedAccessToken,
            encryptedRefreshToken,
            accessTokenExpiresAt: tokens.accessTokenExpiresAt,
            tokenType: tokens.tokenType,
            grantedScopes,
            installedAt,
            disconnectedAt: null,
            lastVerifiedAt: installedAt,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This YouCan store is already connected to another Zomaal store',
        );
      }
      throw error;
    }

    return this.connectionService.getStatus(oauthState.userId);
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl('YOUCAN_AUTH_SUCCESS_REDIRECT_URL', 'connected');
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('YOUCAN_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) {
      return null;
    }
    const url = new URL(configured);
    url.searchParams.set('youcan', status);
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
        `Invalid YouCan OAuth query parameter: ${key}`,
      );
    }
  }
  return query;
}

function normalizeScopes(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean),
    ),
  ].sort();
}

function hashState(state: string): string {
  return createHash('sha256').update(state, 'utf8').digest('hex');
}
