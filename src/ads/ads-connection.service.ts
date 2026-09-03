import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdsConnection, AdsConnectionStatus, AdsPlatform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AdsTokenEncryptionService, adsAccessTokenContext } from './ads-token-encryption.service';

// Generic across every ad platform — TikTok today, Meta/Google/Snapchat
// later reuse this unchanged (they'd add their own *AdsAuthService for the
// OAuth dance, then call the same read/disconnect logic here).
//
// Unlike YouCanConnectionService, there is no in-process token refresh
// queue: TikTok's Marketing API access tokens are long-lived with no
// refresh_token issued (see tiktok-ads-api.service.ts). A 401 from TikTok
// marks the connection REAUTHORIZATION_REQUIRED — the merchant must
// reconnect, there is nothing to silently refresh.
@Injectable()
export class AdsConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenEncryption: AdsTokenEncryptionService,
  ) {}

  async listForStore(userId: string, platform?: AdsPlatform) {
    const store = await this.requireStore(userId);
    const connections = await this.prisma.adsConnection.findMany({
      where: { storeId: store.id, ...(platform ? { platform } : {}) },
      orderBy: [{ platform: 'asc' }, { installedAt: 'asc' }],
    });
    return connections.map(toConnectionSummary);
  }

  async getAccessToken(connection: AdsConnection): Promise<string> {
    if (
      connection.status !== AdsConnectionStatus.ACTIVE ||
      !connection.encryptedAccessToken
    ) {
      throw new ConflictException(
        `Reconnect ${connection.platform} before using this feature`,
      );
    }
    return this.tokenEncryption.decrypt(
      connection.encryptedAccessToken,
      adsAccessTokenContext(connection.platform, connection.externalAdvertiserId),
    );
  }

  async markReauthorizationRequired(connectionId: string): Promise<void> {
    await this.prisma.adsConnection.update({
      where: { id: connectionId },
      data: {
        status: AdsConnectionStatus.REAUTHORIZATION_REQUIRED,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        accessTokenExpiresAt: null,
      },
    });
  }

  async disconnect(userId: string, connectionId: string) {
    const store = await this.requireStore(userId);
    const connection = await this.prisma.adsConnection.findFirst({
      where: { id: connectionId, storeId: store.id },
    });
    if (!connection) {
      throw new NotFoundException('Ads connection not found');
    }
    const updated = await this.prisma.adsConnection.update({
      where: { id: connection.id },
      data: {
        status: AdsConnectionStatus.DISCONNECTED,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        accessTokenExpiresAt: null,
        disconnectedAt: new Date(),
      },
    });
    return toConnectionSummary(updated);
  }

  private async requireStore(userId: string): Promise<{ id: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }
}

export function toConnectionSummary(connection: AdsConnection) {
  return {
    id: connection.id,
    platform: connection.platform,
    status: connection.status,
    externalAdvertiserId: connection.externalAdvertiserId,
    displayName: connection.displayName,
    currency: connection.currency,
    installedAt: connection.installedAt.toISOString(),
    lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: connection.lastSyncError,
  };
}
