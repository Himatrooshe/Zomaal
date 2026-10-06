import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdsConnection,
  AdsConnectionStatus,
  AdsPlatform,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsConnectionService } from '../ads-connection.service';
import { StoreAccessService } from '../../access/store-access.service';
import {
  GoogleAdsApiService,
  type GoogleCampaignStatus,
} from './google-ads-api.service';
import { GoogleAdsAuthService } from './google-ads-auth.service';

// "Select Campaigns" for Google: mirror the live campaign list into
// AdsCampaign, save which ones are tracked, and pause/resume from the app.
@Injectable()
export class GoogleAdsCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly googleApi: GoogleAdsApiService,
    private readonly googleAuth: GoogleAdsAuthService,
    private readonly connections: AdsConnectionService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async refreshAndList(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const live = await this.callGoogle(connection, (token) =>
      this.googleApi.listCampaigns(token, connection.externalAdvertiserId),
    );

    await this.prisma.$transaction(
      live.map((campaign) => {
        const fields = {
          name: campaign.name,
          status: campaign.status,
          objective: campaign.channelType,
          budget:
            campaign.budget !== null
              ? new Prisma.Decimal(campaign.budget)
              : null,
          rawPayload: campaign.raw as Prisma.InputJsonValue,
        };
        return this.prisma.adsCampaign.upsert({
          where: {
            connectionId_externalCampaignId: {
              connectionId: connection.id,
              externalCampaignId: campaign.externalCampaignId,
            },
          },
          create: {
            connectionId: connection.id,
            externalCampaignId: campaign.externalCampaignId,
            currency: connection.currency,
            ...fields,
          },
          update: fields,
        });
      }),
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
    await this.prisma.$transaction([
      this.prisma.adsCampaign.updateMany({
        where: { connectionId: connection.id },
        data: { tracked: false },
      }),
      this.prisma.adsCampaign.updateMany({
        where: {
          connectionId: connection.id,
          externalCampaignId: { in: [...new Set(externalCampaignIds)] },
        },
        data: { tracked: true },
      }),
    ]);
    return this.list(userId, connectionId);
  }

  /** "This will stop your ads immediately" — and the matching resume. */
  async setStatus(
    userId: string,
    connectionId: string,
    externalCampaignId: string,
    status: GoogleCampaignStatus,
  ) {
    if (!/^\d{1,20}$/.test(externalCampaignId)) {
      throw new BadRequestException(
        'externalCampaignId must be a Google campaign id (digits)',
      );
    }
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const campaign = await this.prisma.adsCampaign.findUnique({
      where: {
        connectionId_externalCampaignId: {
          connectionId: connection.id,
          externalCampaignId,
        },
      },
    });
    if (!campaign) {
      throw new NotFoundException(
        'Campaign not found. Refresh the campaign list and try again.',
      );
    }

    await this.callGoogle(connection, (token) =>
      this.googleApi.setCampaignStatus(
        token,
        connection.externalAdvertiserId,
        externalCampaignId,
        status,
      ),
    );
    const updated = await this.prisma.adsCampaign.update({
      where: { id: campaign.id },
      data: { status },
    });
    return toCampaignSelectionDto(updated);
  }

  private async callGoogle<T>(
    connection: AdsConnection,
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.googleAuth.getValidAccessToken(connection);
    try {
      return await call(token);
    } catch (error) {
      if (this.googleApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
        throw new ConflictException(
          'Reconnect Google Ads before using this feature',
        );
      }
      throw error;
    }
  }

  private async requireOwnedConnection(userId: string, connectionId: string) {
    const store = await this.storeAccess.requireStore(userId);
    const connection = await this.prisma.adsConnection.findFirst({
      where: {
        id: connectionId,
        storeId: store.id,
        platform: AdsPlatform.GOOGLE,
      },
    });
    if (!connection) {
      throw new NotFoundException('Google Ads connection not found');
    }
    if (connection.status !== AdsConnectionStatus.ACTIVE) {
      throw new ConflictException(
        'Reconnect Google Ads before using this feature',
      );
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
