import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AdsConnectionStatus, AdsPlatform, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsConnectionService } from '../ads-connection.service';
import { TikTokAdsApiService } from './tiktok-ads-api.service';

// Backs the "Select Campaigns" screens: refreshing the live campaign list
// from TikTok (upserting a read-only mirror into AdsCampaign) and saving
// which ones the merchant checked (tracked = true), which is what
// TikTokAdsSyncService later pulls daily metrics for.
@Injectable()
export class TikTokAdsCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tiktokApi: TikTokAdsApiService,
    private readonly connections: AdsConnectionService,
  ) {}

  async refreshAndList(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const accessToken = await this.connections.getAccessToken(connection);

    let liveCampaigns;
    try {
      liveCampaigns = await this.tiktokApi.listCampaigns(
        accessToken,
        connection.externalAdvertiserId,
      );
    } catch (error) {
      if (this.tiktokApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
      }
      throw error;
    }

    await this.prisma.$transaction(
      liveCampaigns.map((campaign) =>
        this.prisma.adsCampaign.upsert({
          where: {
            connectionId_externalCampaignId: {
              connectionId: connection.id,
              externalCampaignId: campaign.externalCampaignId,
            },
          },
          create: {
            connectionId: connection.id,
            externalCampaignId: campaign.externalCampaignId,
            name: campaign.name,
            status: campaign.status,
            objective: campaign.objective,
            budget: campaign.budget !== null ? new Prisma.Decimal(campaign.budget) : null,
            currency: connection.currency,
            rawPayload: campaign.raw as Prisma.InputJsonValue,
          },
          update: {
            name: campaign.name,
            status: campaign.status,
            objective: campaign.objective,
            budget: campaign.budget !== null ? new Prisma.Decimal(campaign.budget) : null,
            rawPayload: campaign.raw as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    await this.prisma.adsConnection.update({
      where: { id: connection.id },
      data: { lastVerifiedAt: new Date() },
    });

    return this.list(userId, connectionId);
  }

  async list(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const campaigns = await this.prisma.adsCampaign.findMany({
      where: { connectionId: connection.id },
      orderBy: { name: 'asc' },
    });
    return { data: campaigns.map(toCampaignSelectionDto) };
  }

  async saveSelection(
    userId: string,
    connectionId: string,
    externalCampaignIds: string[],
  ) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const selected = new Set(externalCampaignIds);

    await this.prisma.$transaction([
      this.prisma.adsCampaign.updateMany({
        where: { connectionId: connection.id },
        data: { tracked: false },
      }),
      this.prisma.adsCampaign.updateMany({
        where: {
          connectionId: connection.id,
          externalCampaignId: { in: [...selected] },
        },
        data: { tracked: true },
      }),
    ]);

    return this.list(userId, connectionId);
  }

  private async requireOwnedConnection(userId: string, connectionId: string) {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const connection = await this.prisma.adsConnection.findFirst({
      where: {
        id: connectionId,
        storeId: store.id,
        platform: AdsPlatform.TIKTOK,
      },
    });
    if (!connection) {
      throw new NotFoundException('TikTok Ads connection not found');
    }
    if (connection.status !== AdsConnectionStatus.ACTIVE) {
      throw new ConflictException('Reconnect TikTok Ads before using this feature');
    }
    return connection;
  }
}

function toCampaignSelectionDto(campaign: {
  id: string;
  externalCampaignId: string;
  name: string;
  status: string;
  objective: string | null;
  budget: Prisma.Decimal | null;
  currency: string | null;
  startDate: Date | null;
  endDate: Date | null;
  tracked: boolean;
}) {
  return {
    id: campaign.id,
    externalCampaignId: campaign.externalCampaignId,
    name: campaign.name,
    status: campaign.status,
    objective: campaign.objective,
    budget: campaign.budget?.toFixed(2) ?? null,
    currency: campaign.currency,
    startDate: campaign.startDate?.toISOString() ?? null,
    endDate: campaign.endDate?.toISOString() ?? null,
    tracked: campaign.tracked,
  };
}
