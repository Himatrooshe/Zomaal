import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  META_ADS_MANAGE_PERMISSION,
  MetaAdsApiService,
  type MetaCampaignStatus,
} from './meta-ads-api.service';
import { MetaAdsAuthService } from './meta-ads-auth.service';

const RECONNECT_MESSAGE = 'Reconnect Meta Ads before using this feature';

// "Select Campaigns" for Meta: mirror the live campaign list into
// AdsCampaign, save which ones are tracked, and pause/resume from the app.
@Injectable()
export class MetaAdsCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metaApi: MetaAdsApiService,
    private readonly metaAuth: MetaAdsAuthService,
    private readonly connections: AdsConnectionService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async refreshAndList(userId: string, connectionId: string) {
    const connection = await this.requireOwnedConnection(userId, connectionId);
    const live = await this.callMeta(connection, (token) =>
      this.metaApi.listCampaigns(
        token,
        connection.externalAdvertiserId,
        connection.currency,
      ),
    );

    await this.prisma.$transaction(
      live.map((campaign) => {
        const fields = {
          name: campaign.name,
          status: campaign.status,
          objective: campaign.objective,
          budget:
            campaign.budget !== null
              ? new Prisma.Decimal(campaign.budget)
              : null,
          startDate: campaign.startDate,
          endDate: campaign.endDate,
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
    status: MetaCampaignStatus,
  ) {
    if (!/^\d{1,30}$/.test(externalCampaignId)) {
      throw new BadRequestException(
        'externalCampaignId must be a Meta campaign id (digits)',
      );
    }
    const connection = await this.requireOwnedConnection(userId, connectionId);
    if (
      connection.grantedScopes &&
      !connection.grantedScopes.split(',').includes(META_ADS_MANAGE_PERMISSION)
    ) {
      throw new ForbiddenException(
        'Zomaal is not allowed to manage your Meta ads. Reconnect Meta Ads and allow managing ads.',
      );
    }
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

    await this.callMeta(connection, (token) =>
      this.metaApi.setCampaignStatus(token, externalCampaignId, status),
    );
    const updated = await this.prisma.adsCampaign.update({
      where: { id: campaign.id },
      data: { status },
    });
    return toCampaignSelectionDto(updated);
  }

  private async callMeta<T>(
    connection: AdsConnection,
    call: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.metaAuth.getValidAccessToken(connection);
    try {
      return await call(token);
    } catch (error) {
      if (this.metaApi.isUnauthorizedError(error)) {
        await this.connections.markReauthorizationRequired(connection.id);
        throw new ConflictException(RECONNECT_MESSAGE);
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
        platform: AdsPlatform.META,
      },
    });
    if (!connection) {
      throw new NotFoundException('Meta Ads connection not found');
    }
    if (connection.status !== AdsConnectionStatus.ACTIVE) {
      throw new ConflictException(RECONNECT_MESSAGE);
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
