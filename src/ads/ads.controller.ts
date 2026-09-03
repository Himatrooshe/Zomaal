import {
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AdsPlatform } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { AdsConnectionService } from './ads-connection.service';
import { AdsDashboardService } from './ads-dashboard.service';
import { AdsConnectionDto, AdsConnectionListDto } from './dto/ads-connection.dto';
import {
  AdsCampaignListResponseDto,
  AdsCampaignsQueryDto,
  AdsStatisticsQueryDto,
  AdsStatisticsResponseDto,
} from './dto/ads-dashboard.dto';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description: 'Ads data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

// Platform-agnostic. Backs the "Ads Platforms" connect list and the shared
// Metrics/Statistic dashboard screens — works unchanged once Meta/Google/
// Snapchat get their own connect flow under their own /ads/<platform>
// controller (mirrors ads/tiktok.controller.ts).
@ApiTags('Ads')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('ads')
export class AdsController {
  constructor(
    private readonly connections: AdsConnectionService,
    private readonly dashboard: AdsDashboardService,
  ) {}

  @Get('connections')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List connected ad platform accounts',
    description: 'Backs the "Ads Platforms" screen\'s connect/connected state per platform.',
  })
  @ApiQuery({ name: 'platform', enum: AdsPlatform, required: false })
  @ApiOkResponse({ type: AdsConnectionListDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiNotFoundResponse({ description: 'The current user has not created a Zomaal store.', type: ApiErrorDto })
  async listConnections(
    @CurrentUser() user: JwtPayload,
    @Query('platform') platform?: AdsPlatform,
  ): Promise<AdsConnectionListDto> {
    const data = (await this.connections.listForStore(
      user.userId,
      platform,
    )) as AdsConnectionDto[];
    return { data };
  }

  @Delete('connections/:id')
  @ApiOperation({ summary: 'Disconnect an ad platform account' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: AdsConnectionDto })
  @ApiNotFoundResponse({ description: 'Connection not found.', type: ApiErrorDto })
  async disconnect(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdsConnectionDto> {
    return (await this.connections.disconnect(user.userId, id)) as AdsConnectionDto;
  }

  @Get('campaigns')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get tracked campaigns with performance metrics for one platform',
    description:
      'Backs the Metrics tab campaign cards (Spent/Clicks/Results/Cost-R + expandable detail). ' +
      'available is false when the platform has no ACTIVE connection yet.',
  })
  @ApiOkResponse({ type: AdsCampaignListResponseDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.', type: ApiErrorDto })
  getCampaigns(
    @CurrentUser() user: JwtPayload,
    @Query() query: AdsCampaignsQueryDto,
  ): Promise<AdsCampaignListResponseDto> {
    return this.dashboard.getCampaigns(user.userId, query.platform, query.days ?? 1);
  }

  @Get('statistics')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get the cross-platform metric breakdown ring chart',
    description:
      'Backs the Statistic tab ring chart + per-platform legend for one selected metric. ' +
      'Platforms with no ACTIVE connection report available:false and a 0 share.',
  })
  @ApiOkResponse({ type: AdsStatisticsResponseDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.', type: ApiErrorDto })
  getStatistics(
    @CurrentUser() user: JwtPayload,
    @Query() query: AdsStatisticsQueryDto,
  ): Promise<AdsStatisticsResponseDto> {
    return this.dashboard.getStatistics(user.userId, query.period, query.metric);
  }
}
