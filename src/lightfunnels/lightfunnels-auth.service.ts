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
  LightfunnelsConnectionStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { LightfunnelsConnectionStatusDto } from './dto/lightfunnels-response.dto';
import { LightfunnelsApiService } from './lightfunnels-api.service';
import { LightfunnelsConnectionService } from './lightfunnels-connection.service';
import { lightfunnelsAccessTokenContext } from './lightfunnels-token-context';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';

@Injectable()
export class LightfunnelsAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly lightfunnelsApi: LightfunnelsApiService,
    private readonly connectionService: LightfunnelsConnectionService,
    private readonly tokenEncryption: LightfunnelsTokenEncryptionService,
  ) {}

  async begin(userId: string) {
    this.lightfunnelsApi.assertConfigured();
    this.tokenEncryption.assertConfigured();

    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException(
        'Create your Zomaal store before connecting Lightfunnels',
      );
    }

    const state = randomBytes(32).toString('base64url');
    const stateHash = hashState(state);
    const requestedScopes = this.lightfunnelsApi.getRequestedScopes();
    const expiresAt = new Date(
      Date.now() +
        this.configService.get<number>(
          'LIGHTFUNNELS_OAUTH_STATE_TTL_SECONDS',
          600,
        ) *
          1000,
    );

    await this.prisma.$transaction([
      this.prisma.lightfunnelsOAuthState.deleteMany({
        where: {
          OR: [{ expiresAt: { lte: new Date() } }, { storeId: store.id }],
        },
      }),
      this.prisma.lightfunnelsOAuthState.create({
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
      authorizationUrl: this.lightfunnelsApi.buildAuthorizationUrl(
        state,
        requestedScopes,
      ),
      requestedScopes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async complete(
    rawQuery: Record<string, unknown>,
  ): Promise<LightfunnelsConnectionStatusDto> {
    const query = normalizeQuery(rawQuery);
    if (!query.state) {
      throw new BadRequestException(
        'Lightfunnels OAuth callback is missing state',
      );
    }

    const stateHash = hashState(query.state);
    const oauthState = await this.prisma.lightfunnelsOAuthState.findUnique({
      where: { stateHash },
    });
    if (!oauthState) {
      throw new UnauthorizedException(
        'Lightfunnels OAuth state is invalid or has already been used',
      );
    }
    if (oauthState.expiresAt.getTime() <= Date.now()) {
      await this.prisma.lightfunnelsOAuthState.deleteMany({
        where: { stateHash },
      });
      throw new UnauthorizedException('Lightfunnels OAuth state has expired');
    }

    const consumed = await this.prisma.lightfunnelsOAuthState.deleteMany({
      where: { stateHash },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'Lightfunnels OAuth state is invalid or has already been used',
      );
    }
    if (query.error) {
      throw new UnauthorizedException(
        query.error === 'access_denied'
          ? 'Lightfunnels authorization was canceled by the merchant'
          : 'Lightfunnels authorization failed',
      );
    }
    if (!query.code) {
      throw new BadRequestException(
        'Lightfunnels OAuth callback is missing code',
      );
    }

    const accessToken = await this.lightfunnelsApi.exchangeAuthorizationCode(
      query.code,
    );
    const account = await this.lightfunnelsApi.getAccountDetails(accessToken);
    const firstStore = account.stores[0] ?? null;

    const existingAccount = await this.prisma.lightfunnelsConnection.findUnique(
      {
        where: { externalAccountId: account.accountId },
        select: { storeId: true },
      },
    );
    if (existingAccount && existingAccount.storeId !== oauthState.storeId) {
      throw new ConflictException(
        'This Lightfunnels account is already connected to another Zomaal store',
      );
    }

    const encryptedAccessToken = this.tokenEncryption.encrypt(
      accessToken,
      lightfunnelsAccessTokenContext(account.accountId),
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
                platform: EcommercePlatform.LIGHTFUNNELS,
              },
            },
          });
        const accountChanged =
          existingConnection !== null &&
          existingConnection.externalAccountId !== account.accountId;
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
                platform: EcommercePlatform.LIGHTFUNNELS,
              },
            },
            create: {
              storeId: oauthState.storeId,
              platform: EcommercePlatform.LIGHTFUNNELS,
              externalAccountId: account.accountId,
              displayName: firstStore?.name ?? firstStore?.domain,
              status: EcommerceConnectionStatus.ACTIVE,
              includeInRevenue: false,
            },
            update: {
              externalAccountId: account.accountId,
              displayName: firstStore?.name ?? firstStore?.domain,
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

        await transaction.lightfunnelsConnection.upsert({
          where: { storeId: oauthState.storeId },
          create: {
            storeId: oauthState.storeId,
            ecommerceConnectionId: ecommerceConnection.id,
            externalAccountId: account.accountId,
            displayName: firstStore?.name,
            storeDomain: firstStore?.domain,
            status: LightfunnelsConnectionStatus.ACTIVE,
            encryptedAccessToken,
            grantedScopes,
            lastVerifiedAt: installedAt,
          },
          update: {
            ecommerceConnectionId: ecommerceConnection.id,
            externalAccountId: account.accountId,
            displayName: firstStore?.name,
            storeDomain: firstStore?.domain,
            status: LightfunnelsConnectionStatus.ACTIVE,
            encryptedAccessToken,
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
          'This Lightfunnels account is already connected to another Zomaal store',
        );
      }
      throw error;
    }

    return this.connectionService.getStatus(oauthState.userId);
  }

  getSuccessRedirectUrl(): string | null {
    return this.redirectUrl(
      'LIGHTFUNNELS_AUTH_SUCCESS_REDIRECT_URL',
      'connected',
    );
  }

  getFailureRedirectUrl(): string | null {
    return this.redirectUrl('LIGHTFUNNELS_AUTH_FAILURE_REDIRECT_URL', 'failed');
  }

  private redirectUrl(key: string, status: string): string | null {
    const configured = this.configService.get<string>(key)?.trim();
    if (!configured) {
      return null;
    }
    const url = new URL(configured);
    url.searchParams.set('lightfunnels', status);
    return url.toString();
  }
}

function normalizeQuery(
  rawQuery: Record<string, unknown>,
): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawQuery)) {
    if (typeof value !== 'string') {
      throw new BadRequestException(
        `Invalid Lightfunnels OAuth query parameter: ${key}`,
      );
    }
    query[key] = value;
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
