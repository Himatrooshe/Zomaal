import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EcommerceConnectionStatus,
  LightfunnelsConnection,
  LightfunnelsConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  LightfunnelsConnectionStatusDto,
  LightfunnelsVerificationDto,
} from './dto/lightfunnels-response.dto';
import {
  LightfunnelsApiService,
  type LightfunnelsAccountDetails,
} from './lightfunnels-api.service';
import { lightfunnelsAccessTokenContext } from './lightfunnels-token-context';
import { LightfunnelsTokenEncryptionService } from './lightfunnels-token-encryption.service';

interface LightfunnelsCredentials {
  connectionId: string;
  ecommerceConnectionId: string;
  externalAccountId: string;
  accessToken: string;
}

@Injectable()
export class LightfunnelsConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lightfunnelsApi: LightfunnelsApiService,
    private readonly tokenEncryption: LightfunnelsTokenEncryptionService,
  ) {}

  async getStatus(userId: string): Promise<LightfunnelsConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { lightfunnelsConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return this.toStatus(store.lightfunnelsConnection);
  }

  async verify(userId: string): Promise<LightfunnelsVerificationDto> {
    const { credentials, account } =
      await this.getAccountWithCredentials(userId);
    if (account.accountId !== credentials.externalAccountId) {
      throw new ServiceUnavailableException(
        'Lightfunnels returned details for an unexpected account',
      );
    }
    const firstStore = account.stores[0] ?? null;
    await this.prisma.lightfunnelsConnection.update({
      where: { id: credentials.connectionId },
      data: {
        displayName: firstStore?.name,
        storeDomain: firstStore?.domain,
        lastVerifiedAt: new Date(),
      },
    });
    return {
      accountId: account.accountId,
      stores: account.stores,
      verified: true,
    };
  }

  async graphqlForUser<T>(
    userId: string,
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T> {
    const credentials = await this.getAccessCredentials(userId);
    try {
      return await this.lightfunnelsApi.graphql<T>(
        credentials.accessToken,
        query,
        variables,
      );
    } catch (error) {
      if (this.lightfunnelsApi.isUnauthorizedError(error)) {
        await this.markReauthorizationRequired(credentials);
      }
      throw error;
    }
  }

  async disconnect(userId: string): Promise<LightfunnelsConnectionStatusDto> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = await this.prisma.lightfunnelsConnection.findUnique({
      where: { storeId: store.id },
      select: { id: true, ecommerceConnectionId: true },
    });
    if (!connection) {
      throw new NotFoundException('Lightfunnels connection not found');
    }

    await this.prisma.$transaction([
      this.prisma.lightfunnelsConnection.update({
        where: { id: connection.id },
        data: {
          status: LightfunnelsConnectionStatus.DISCONNECTED,
          encryptedAccessToken: null,
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
        'Lightfunnels credentials were removed from Zomaal. Revoke the app in Lightfunnels if you also want to end provider-side access.',
    };
  }

  private async getAccountWithCredentials(userId: string): Promise<{
    credentials: LightfunnelsCredentials;
    account: LightfunnelsAccountDetails;
  }> {
    const credentials = await this.getAccessCredentials(userId);
    try {
      const account = await this.lightfunnelsApi.getAccountDetails(
        credentials.accessToken,
      );
      return { credentials, account };
    } catch (error) {
      if (this.lightfunnelsApi.isUnauthorizedError(error)) {
        await this.markReauthorizationRequired(credentials);
      }
      throw error;
    }
  }

  private async getAccessCredentials(
    userId: string,
  ): Promise<LightfunnelsCredentials> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      include: { lightfunnelsConnection: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = store.lightfunnelsConnection;
    if (
      !connection ||
      connection.status !== LightfunnelsConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(
        'Connect or reconnect Lightfunnels before using this feature',
      );
    }
    return {
      connectionId: connection.id,
      ecommerceConnectionId: connection.ecommerceConnectionId,
      externalAccountId: connection.externalAccountId,
      accessToken: this.tokenEncryption.decrypt(
        connection.encryptedAccessToken,
        lightfunnelsAccessTokenContext(connection.externalAccountId),
      ),
    };
  }

  private async markReauthorizationRequired(
    credentials: LightfunnelsCredentials,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.lightfunnelsConnection.updateMany({
        where: { id: credentials.connectionId },
        data: {
          status: LightfunnelsConnectionStatus.REAUTHORIZATION_REQUIRED,
          encryptedAccessToken: null,
        },
      }),
      this.prisma.ecommerceConnection.updateMany({
        where: { id: credentials.ecommerceConnectionId },
        data: {
          status: EcommerceConnectionStatus.REAUTHORIZATION_REQUIRED,
        },
      }),
    ]);
  }

  private toStatus(
    connection: LightfunnelsConnection | null,
  ): LightfunnelsConnectionStatusDto {
    if (!connection) {
      return {
        connected: false,
        accountId: null,
        displayName: null,
        storeDomain: null,
        status: 'not_connected',
        grantedScopes: [],
        installedAt: null,
        lastVerifiedAt: null,
        scopeUpdateRequired: false,
        message: 'Lightfunnels account is not connected',
      };
    }
    const grantedScopes = normalizeScopes(connection.grantedScopes);
    const granted = new Set(grantedScopes);
    const scopeUpdateRequired = this.lightfunnelsApi
      .getRequestedScopes()
      .some((scope) => !granted.has(scope));
    const status = mapStatus(connection.status);
    return {
      connected: connection.status === LightfunnelsConnectionStatus.ACTIVE,
      accountId: connection.externalAccountId,
      displayName: connection.displayName,
      storeDomain: connection.storeDomain,
      status,
      grantedScopes,
      installedAt: connection.installedAt.toISOString(),
      lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
      scopeUpdateRequired,
      message:
        status === 'active'
          ? 'Lightfunnels account is connected'
          : status === 'reauthorization_required'
            ? 'Lightfunnels account must be reconnected'
            : 'Lightfunnels account is disconnected',
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
  status: LightfunnelsConnectionStatus,
): LightfunnelsConnectionStatusDto['status'] {
  switch (status) {
    case LightfunnelsConnectionStatus.ACTIVE:
      return 'active';
    case LightfunnelsConnectionStatus.REAUTHORIZATION_REQUIRED:
      return 'reauthorization_required';
    case LightfunnelsConnectionStatus.DISCONNECTED:
      return 'disconnected';
    default:
      throw new ServiceUnavailableException(
        'Unknown Lightfunnels connection status',
      );
  }
}
