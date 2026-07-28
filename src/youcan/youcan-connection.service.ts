import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EcommerceConnectionStatus,
  YouCanConnection,
  YouCanConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  YouCanConnectionStatusDto,
  YouCanStoreVerificationDto,
} from './dto/youcan-response.dto';
import {
  YouCanApiService,
  type YouCanImageUploadFile,
  type YouCanStoreDetails,
  type YouCanTokenSet,
} from './youcan-api.service';
import {
  youCanAccessTokenContext,
  youCanRefreshTokenContext,
} from './youcan-token-context';
import { YouCanTokenEncryptionService } from './youcan-token-encryption.service';

interface YouCanAccessCredentials {
  externalStoreId: string;
  accessToken: string;
}

@Injectable()
export class YouCanConnectionService {
  private readonly refreshes = new Map<
    string,
    Promise<YouCanAccessCredentials>
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly youCanApi: YouCanApiService,
    private readonly tokenEncryption: YouCanTokenEncryptionService,
  ) {}

  async getStatus(userId: string): Promise<YouCanConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { youCanConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return this.toStatus(store.youCanConnection);
  }

  async verify(userId: string): Promise<YouCanStoreVerificationDto> {
    const { credentials, details } =
      await this.getStoreDetailsWithCredentials(userId);

    if (details.storeId !== credentials.externalStoreId) {
      throw new ServiceUnavailableException(
        'YouCan returned details for an unexpected store',
      );
    }

    await this.prisma.youCanConnection.update({
      where: { externalStoreId: credentials.externalStoreId },
      data: {
        storeDomain: details.domain,
        displayName: details.name,
        currencyCode: details.currencyCode,
        lastVerifiedAt: new Date(),
      },
    });

    return {
      storeId: details.storeId,
      slug: details.slug,
      name: details.name,
      domain: details.domain,
      currencyCode: details.currencyCode,
      isActive: details.isActive,
      verified: true,
    };
  }

  async getJsonForUser<T>(
    userId: string,
    path: string,
    query?: Record<string, string | number | null | undefined>,
  ): Promise<T> {
    let credentials = await this.getAccessCredentials(userId);
    try {
      return await this.youCanApi.getJson<T>(
        path,
        credentials.accessToken,
        query,
      );
    } catch (error) {
      if (!this.youCanApi.isUnauthorizedError(error)) {
        throw error;
      }
      credentials = await this.performRefresh(credentials);
      return await this.youCanApi.getJson<T>(
        path,
        credentials.accessToken,
        query,
      );
    }
  }

  async postJsonForUser<T>(
    userId: string,
    path: string,
    body: Record<string, any>,
  ): Promise<T> {
    let credentials = await this.getAccessCredentials(userId);
    try {
      return await this.youCanApi.postJson<T>(
        path,
        credentials.accessToken,
        body,
      );
    } catch (error) {
      if (!this.youCanApi.isUnauthorizedError(error)) {
        throw error;
      }
      credentials = await this.performRefresh(credentials);
      return await this.youCanApi.postJson<T>(
        path,
        credentials.accessToken,
        body,
      );
    }
  }

  async postImagesForUser<T>(
    userId: string,
    path: string,
    files: YouCanImageUploadFile[],
  ): Promise<T> {
    let credentials = await this.getAccessCredentials(userId);
    try {
      return await this.youCanApi.postImages<T>(
        path,
        credentials.accessToken,
        files,
      );
    } catch (error) {
      if (!this.youCanApi.isUnauthorizedError(error)) {
        throw error;
      }
      credentials = await this.performRefresh(credentials);
      return await this.youCanApi.postImages<T>(
        path,
        credentials.accessToken,
        files,
      );
    }
  }

  async getStoreCurrency(userId: string): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { youCanConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    if (
      !store.youCanConnection ||
      store.youCanConnection.status !== YouCanConnectionStatus.ACTIVE
    ) {
      throw new ConflictException(
        'Connect or reconnect YouCan before using this feature',
      );
    }
    if (store.youCanConnection.currencyCode) {
      return store.youCanConnection.currencyCode;
    }

    const { credentials, details } =
      await this.getStoreDetailsWithCredentials(userId);
    if (!details.currencyCode) {
      throw new ServiceUnavailableException(
        'YouCan store details did not include a currency',
      );
    }
    if (details.storeId !== credentials.externalStoreId) {
      throw new ServiceUnavailableException(
        'YouCan returned details for an unexpected store',
      );
    }
    await this.prisma.youCanConnection.update({
      where: { externalStoreId: credentials.externalStoreId },
      data: { currencyCode: details.currencyCode },
    });
    return details.currencyCode;
  }

  async disconnect(userId: string): Promise<YouCanConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = await this.prisma.youCanConnection.findUnique({
      where: { storeId: store.id },
      select: { id: true, ecommerceConnectionId: true },
    });
    if (!connection) {
      throw new NotFoundException('YouCan connection not found');
    }

    await this.prisma.$transaction([
      this.prisma.youCanConnection.update({
        where: { id: connection.id },
        data: {
          status: YouCanConnectionStatus.DISCONNECTED,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          accessTokenExpiresAt: null,
          disconnectedAt: new Date(),
        },
      }),
      this.prisma.ecommerceConnection.update({
        where: { id: connection.ecommerceConnectionId },
        data: { status: EcommerceConnectionStatus.DISCONNECTED },
      }),
    ]);

    const status = await this.getStatus(userId);
    return {
      ...status,
      message:
        'YouCan credentials were removed from Zomaal. Revoke the app in YouCan Seller Area if you also want to end provider-side access.',
    };
  }

  private async getAccessCredentials(
    userId: string,
    forceRefresh = false,
  ): Promise<YouCanAccessCredentials> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { youCanConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = store.youCanConnection;
    if (
      !connection ||
      connection.status !== YouCanConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(
        'Connect or reconnect YouCan before using this feature',
      );
    }

    const refreshSkewMs =
      this.configService.get<number>('YOUCAN_TOKEN_REFRESH_SKEW_SECONDS', 300) *
      1000;
    const needsRefresh =
      forceRefresh ||
      !connection.accessTokenExpiresAt ||
      connection.accessTokenExpiresAt.getTime() <= Date.now() + refreshSkewMs;

    if (needsRefresh) {
      return this.refreshConnection(connection);
    }
    return {
      externalStoreId: connection.externalStoreId,
      accessToken: this.tokenEncryption.decrypt(
        connection.encryptedAccessToken,
        youCanAccessTokenContext(connection.externalStoreId),
      ),
    };
  }

  private async getStoreDetailsWithCredentials(userId: string): Promise<{
    credentials: YouCanAccessCredentials;
    details: YouCanStoreDetails;
  }> {
    let credentials = await this.getAccessCredentials(userId);
    try {
      const details = await this.youCanApi.getStoreDetails(
        credentials.accessToken,
      );
      return { credentials, details };
    } catch (error) {
      if (!this.youCanApi.isUnauthorizedError(error)) {
        throw error;
      }
      credentials = await this.getAccessCredentials(userId, true);
      const details = await this.youCanApi.getStoreDetails(
        credentials.accessToken,
      );
      return { credentials, details };
    }
  }

  private refreshConnection(
    connection: YouCanConnection,
  ): Promise<YouCanAccessCredentials> {
    const running = this.refreshes.get(connection.id);
    if (running) {
      return running;
    }
    const refresh = this.performRefresh(connection).finally(() => {
      this.refreshes.delete(connection.id);
    });
    this.refreshes.set(connection.id, refresh);
    return refresh;
  }

  private async performRefresh(
    initialConnection: YouCanConnection | YouCanAccessCredentials,
  ): Promise<YouCanAccessCredentials> {
    const connectionId =
      'id' in initialConnection ? initialConnection.id : undefined;
    const externalStoreId =
      'externalStoreId' in initialConnection
        ? initialConnection.externalStoreId
        : undefined;

    const connection = await this.prisma.youCanConnection.findFirst({
      where: connectionId ? { id: connectionId } : { externalStoreId },
    });
    if (
      !connection ||
      connection.status !== YouCanConnectionStatus.ACTIVE ||
      !connection.encryptedRefreshToken
    ) {
      throw new ConflictException('YouCan connection requires authorization');
    }

    const refreshToken = this.tokenEncryption.decrypt(
      connection.encryptedRefreshToken,
      youCanRefreshTokenContext(connection.externalStoreId),
    );

    let tokens: YouCanTokenSet;
    try {
      tokens = await this.youCanApi.refreshAccessToken(refreshToken);
    } catch (error) {
      if (this.youCanApi.isUnauthorizedError(error)) {
        await this.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    await this.prisma.$transaction([
      this.prisma.youCanConnection.update({
        where: { id: connection.id },
        data: {
          encryptedAccessToken: this.tokenEncryption.encrypt(
            tokens.accessToken,
            youCanAccessTokenContext(connection.externalStoreId),
          ),
          encryptedRefreshToken: this.tokenEncryption.encrypt(
            tokens.refreshToken,
            youCanRefreshTokenContext(connection.externalStoreId),
          ),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          tokenType: tokens.tokenType,
        },
      }),
      this.prisma.ecommerceConnection.update({
        where: { id: connection.ecommerceConnectionId },
        data: { status: EcommerceConnectionStatus.ACTIVE },
      }),
    ]);

    return {
      externalStoreId: connection.externalStoreId,
      accessToken: tokens.accessToken,
    };
  }

  private async markReauthorizationRequired(connectionId: string) {
    const connection = await this.prisma.youCanConnection.findUnique({
      where: { id: connectionId },
      select: { ecommerceConnectionId: true },
    });
    if (!connection) {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.youCanConnection.update({
        where: { id: connectionId },
        data: {
          status: YouCanConnectionStatus.REAUTHORIZATION_REQUIRED,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          accessTokenExpiresAt: null,
        },
      }),
      this.prisma.ecommerceConnection.update({
        where: { id: connection.ecommerceConnectionId },
        data: {
          status: EcommerceConnectionStatus.REAUTHORIZATION_REQUIRED,
        },
      }),
    ]);
  }

  private toStatus(
    connection: YouCanConnection | null,
  ): YouCanConnectionStatusDto {
    if (!connection) {
      return {
        connected: false,
        storeId: null,
        displayName: null,
        storeDomain: null,
        status: 'not_connected',
        grantedScopes: [],
        installedAt: null,
        lastVerifiedAt: null,
        scopeUpdateRequired: false,
        message: 'YouCan store is not connected',
      };
    }

    const grantedScopes = normalizeScopes(connection.grantedScopes);
    const granted = new Set(grantedScopes);
    const scopeUpdateRequired =
      !granted.has('*') &&
      this.youCanApi.getRequestedScopes().some((scope) => !granted.has(scope));
    const status = mapStatus(connection.status);

    return {
      connected: connection.status === YouCanConnectionStatus.ACTIVE,
      storeId: connection.externalStoreId,
      displayName: connection.displayName,
      storeDomain: connection.storeDomain,
      status,
      grantedScopes,
      installedAt: connection.installedAt.toISOString(),
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      scopeUpdateRequired,
      message:
        status === 'active'
          ? 'YouCan store is connected'
          : status === 'reauthorization_required'
            ? 'YouCan store must be reconnected'
            : 'YouCan store is disconnected',
    };
  }
}

function normalizeScopes(value: string): string[] {
  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
}

function mapStatus(
  status: YouCanConnectionStatus,
): YouCanConnectionStatusDto['status'] {
  switch (status) {
    case YouCanConnectionStatus.ACTIVE:
      return 'active';
    case YouCanConnectionStatus.REAUTHORIZATION_REQUIRED:
      return 'reauthorization_required';
    case YouCanConnectionStatus.DISCONNECTED:
      return 'disconnected';
    default:
      throw new ServiceUnavailableException('Unknown YouCan connection status');
  }
}
