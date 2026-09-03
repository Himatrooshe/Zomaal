import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { TikTokAuthStartResponseDto } from '../dto/ads-connection.dto';
import {
  SaveTikTokCampaignSelectionDto,
  TikTokCampaignListResponseDto,
} from '../dto/tiktok-campaign.dto';
import { TikTokAdsAuthService } from './tiktok-ads-auth.service';
import { TikTokAdsCampaignService } from './tiktok-ads-campaign.service';

@ApiTags('Ads — TikTok')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('ads/tiktok')
export class TikTokAdsController {
  constructor(
    private readonly authService: TikTokAdsAuthService,
    private readonly campaignService: TikTokAdsCampaignService,
  ) {}

  @Post('auth/start')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting a TikTok Ads account',
    description:
      'Returns a short-lived authorization URL ("Continue with TikTok"). Open it in the ' +
      'merchant\'s browser; do not request it server-to-server.',
  })
  @ApiOkResponse({ type: TikTokAuthStartResponseDto })
  @ApiNotFoundResponse({ description: 'The current user has not created a Zomaal store.', type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ description: 'TikTok Ads OAuth is not configured.', type: ApiErrorDto })
  begin(@CurrentUser() user: JwtPayload): Promise<TikTokAuthStartResponseDto> {
    return this.authService.begin(user.userId);
  }

  @Get('campaigns/:connectionId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List campaigns for the "Select Campaigns" screen',
    description:
      'Pass refresh=true to re-fetch the live list from TikTok first (the spinning-refresh ' +
      'state on the mockup); omit it to read the last-known list from our DB.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  @ApiOkResponse({ type: TikTokCampaignListResponseDto })
  @ApiNotFoundResponse({ description: 'Connection not found.', type: ApiErrorDto })
  @ApiConflictResponse({ description: 'Reconnect TikTok Ads before using this feature.', type: ApiErrorDto })
  listCampaigns(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Query('refresh') refresh?: string,
  ): Promise<TikTokCampaignListResponseDto> {
    return refresh === 'true'
      ? this.campaignService.refreshAndList(user.userId, connectionId)
      : this.campaignService.list(user.userId, connectionId);
  }

  @Post('campaigns/:connectionId/selection')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save which campaigns to track ("Save Campaigns")',
    description: 'Only tracked campaigns are synced for metrics — untracked campaigns are ignored by the sync.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiOkResponse({ type: TikTokCampaignListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.', type: ApiErrorDto })
  @ApiNotFoundResponse({ description: 'Connection not found.', type: ApiErrorDto })
  saveSelection(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() dto: SaveTikTokCampaignSelectionDto,
  ): Promise<TikTokCampaignListResponseDto> {
    return this.campaignService.saveSelection(
      user.userId,
      connectionId,
      dto.externalCampaignIds,
    );
  }
}
