import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EcommerceConnectionStatus,
  ShopifyConnection,
  ShopifyConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ShopifyConnectionStatusDto,
  ShopifyShopVerificationDto,
} from './dto/shopify-response.dto';
import { ShopifyApiService, type ShopifyTokenSet } from './shopify-api.service';
import {
  accessTokenContext,
  refreshTokenContext,
} from './shopify-token-context';
import { ShopifyTokenEncryptionService } from './shopify-token-encryption.service';

interface AccessCredentials {
  shopDomain: string;
  accessToken: string;
}

interface ShopQueryResponse {
  shop: {
    id: string;
    name: string;
    myshopifyDomain: string;
    currencyCode: string;
  };
}

const SHOP_QUERY = `#graphql
  query ZomaalVerifyShopifyConnection {
    shop {
      id
      name
      myshopifyDomain
      currencyCode
    }
  }
`;

@Injectable()
export class ShopifyConnectionService {
  private readonly refreshes = new Map<string, Promise<AccessCredentials>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly shopifyApi: ShopifyApiService,
    private readonly tokenEncryption: ShopifyTokenEncryptionService,
  ) {}

  async getStatus(userId: string): Promise<ShopifyConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { shopifyConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return this.toStatus(store.shopifyConnection);
  }

  async disconnect(userId: string): Promise<ShopifyConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { storeId: store.id },
      select: { id: true, ecommerceConnectionId: true },
    });
    if (!connection) {
      throw new NotFoundException('Shopify connection not found');
    }

    await this.prisma.$transaction([
      this.prisma.shopifyConnection.update({
        where: { id: connection.id },
        data: {
          status: ShopifyConnectionStatus.DISCONNECTED,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
          disconnectedAt: new Date(),
        },
      }),
      ...(connection.ecommerceConnectionId
        ? [
            this.prisma.ecommerceConnection.update({
              where: { id: connection.ecommerceConnectionId },
              data: { status: EcommerceConnectionStatus.DISCONNECTED },
            }),
          ]
        : []),
    ]);

    const status = await this.getStatus(userId);
    return {
      ...status,
      message:
        'Shopify credentials removed from Zomaal. Uninstall the app in Shopify Admin to revoke the installation.',
    };
  }

  async verify(userId: string): Promise<ShopifyShopVerificationDto> {
    const data = await this.graphqlForUser<ShopQueryResponse>(
      userId,
      SHOP_QUERY,
    );
    await this.prisma.shopifyConnection.update({
      where: { shopDomain: data.shop.myshopifyDomain },
      data: { lastVerifiedAt: new Date() },
    });
    return { ...data.shop, verified: true };
  }

  async graphqlForUser<T>(
    userId: string,
    operation: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    let credentials = await this.getAccessCredentials(userId);
    try {
      return await this.shopifyApi.graphqlRequest<T>(
        credentials.shopDomain,
        credentials.accessToken,
        operation,
        variables,
      );
    } catch (error) {
      if (!this.shopifyApi.isUnauthorizedError(error)) {
        throw error;
      }
      credentials = await this.getAccessCredentials(userId, true);
      return this.shopifyApi.graphqlRequest<T>(
        credentials.shopDomain,
        credentials.accessToken,
        operation,
        variables,
      );
    }
  }

  private async getAccessCredentials(
    userId: string,
    forceRefresh = false,
  ): Promise<AccessCredentials> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { shopifyConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = store.shopifyConnection;
    if (
      !connection ||
      connection.status !== ShopifyConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(
        'Connect or reconnect Shopify before using this feature',
      );
    }

    const refreshSkewMs =
      this.configService.get<number>(
        'SHOPIFY_TOKEN_REFRESH_SKEW_SECONDS',
        300,
      ) * 1000;
    const needsRefresh =
      forceRefresh ||
      !connection.accessTokenExpiresAt ||
      connection.accessTokenExpiresAt.getTime() <= Date.now() + refreshSkewMs;

    if (needsRefresh) {
      return this.refreshConnection(connection);
    }
    return {
      shopDomain: connection.shopDomain,
      accessToken: this.tokenEncryption.decrypt(
        connection.encryptedAccessToken,
        accessTokenContext(connection.shopDomain),
      ),
    };
  }

  private refreshConnection(
    connection: ShopifyConnection,
  ): Promise<AccessCredentials> {
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
    initialConnection: ShopifyConnection,
  ): Promise<AccessCredentials> {
    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { id: initialConnection.id },
    });
    if (
      !connection ||
      connection.status !== ShopifyConnectionStatus.ACTIVE ||
      !connection.encryptedRefreshToken
    ) {
      throw new ConflictException('Shopify connection requires authorization');
    }
    if (
      !connection.refreshTokenExpiresAt ||
      connection.refreshTokenExpiresAt.getTime() <= Date.now()
    ) {
      await this.markReauthorizationRequired(connection.id);
      throw new UnauthorizedException(
        'Shopify refresh token expired; reconnect the store',
      );
    }

    const refreshToken = this.tokenEncryption.decrypt(
      connection.encryptedRefreshToken,
      refreshTokenContext(connection.shopDomain),
    );

    let tokens: ShopifyTokenSet;
    try {
      tokens = await this.shopifyApi.refreshAccessToken(
        connection.shopDomain,
        refreshToken,
      );
    } catch (error) {
      if (this.shopifyApi.isUnauthorizedError(error)) {
        await this.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    await this.prisma.$transaction([
      this.prisma.shopifyConnection.update({
        where: { id: connection.id },
        data: {
          encryptedAccessToken: this.tokenEncryption.encrypt(
            tokens.accessToken,
            accessTokenContext(connection.shopDomain),
          ),
          encryptedRefreshToken: this.tokenEncryption.encrypt(
            tokens.refreshToken,
            refreshTokenContext(connection.shopDomain),
          ),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          grantedScopes: tokens.grantedScopes,
          status: ShopifyConnectionStatus.ACTIVE,
        },
      }),
      ...(connection.ecommerceConnectionId
        ? [
            this.prisma.ecommerceConnection.update({
              where: { id: connection.ecommerceConnectionId },
              data: { status: EcommerceConnectionStatus.ACTIVE },
            }),
          ]
        : []),
    ]);

    return {
      shopDomain: connection.shopDomain,
      accessToken: tokens.accessToken,
    };
  }

  private async markReauthorizationRequired(connectionId: string) {
    const connection = await this.prisma.shopifyConnection.findUnique({
      where: { id: connectionId },
      select: { ecommerceConnectionId: true },
    });
    if (!connection) {
      return;
    }
    await this.prisma.$transaction([
      this.prisma.shopifyConnection.update({
        where: { id: connectionId },
        data: {
          status: ShopifyConnectionStatus.REAUTHORIZATION_REQUIRED,
          encryptedAccessToken: null,
          encryptedRefreshToken: null,
          accessTokenExpiresAt: null,
          refreshTokenExpiresAt: null,
        },
      }),
      ...(connection.ecommerceConnectionId
        ? [
            this.prisma.ecommerceConnection.update({
              where: { id: connection.ecommerceConnectionId },
              data: {
                status: EcommerceConnectionStatus.REAUTHORIZATION_REQUIRED,
              },
            }),
          ]
        : []),
    ]);
  }

  private toStatus(
    connection: ShopifyConnection | null,
  ): ShopifyConnectionStatusDto {
    if (!connection) {
      return {
        connected: false,
        shopDomain: null,
        status: 'not_connected',
        grantedScopes: [],
        installedAt: null,
        lastVerifiedAt: null,
        scopeUpdateRequired: false,
        message: 'Shopify store is not connected',
      };
    }

    const grantedScopes = connection.grantedScopes
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean)
      .sort();
    const expectedScopes = this.shopifyApi.getExpectedScopes();
    const granted = new Set(grantedScopes);
    const scopeUpdateRequired = expectedScopes.some(
      (scope) => !granted.has(scope),
    );
    const status = mapStatus(connection.status);

    return {
      connected: connection.status === ShopifyConnectionStatus.ACTIVE,
      shopDomain: connection.shopDomain,
      status,
      grantedScopes,
      installedAt: connection.installedAt.toISOString(),
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      scopeUpdateRequired,
      message:
        status === 'active'
          ? 'Shopify store is connected'
          : status === 'reauthorization_required'
            ? 'Shopify store must be reconnected'
            : 'Shopify store is disconnected',
    };
  }
}

function mapStatus(
  status: ShopifyConnectionStatus,
): ShopifyConnectionStatusDto['status'] {
  switch (status) {
    case ShopifyConnectionStatus.ACTIVE:
      return 'active';
    case ShopifyConnectionStatus.REAUTHORIZATION_REQUIRED:
      return 'reauthorization_required';
    case ShopifyConnectionStatus.DISCONNECTED:
      return 'disconnected';
    default:
      throw new ServiceUnavailableException(
        'Unknown Shopify connection status',
      );
  }
}
