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
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { PermissionGuard } from '../../access/permission.guard';
import { RequirePermission } from '../../access/require-permission.decorator';
import { PERMISSIONS } from '../../access/permissions';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { RequirePlanFeature } from '../../billing/billing.decorators';
import { PLAN_FEATURES } from '../../billing/plan-features';
import {
  GoogleAdsAuthStartResponseDto,
  GoogleCampaignDto,
  GoogleCampaignListResponseDto,
  SaveGoogleCampaignSelectionDto,
  SetGoogleCampaignStatusDto,
} from '../dto/google-ads.dto';
import { GoogleAdsAuthService } from './google-ads-auth.service';
import { GoogleAdsCampaignService } from './google-ads-campaign.service';

@ApiTags('Ads — Google')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@RequirePlanFeature(PLAN_FEATURES.ADS)
@Controller('ads/google')
export class GoogleAdsController {
  constructor(
    private readonly authService: GoogleAdsAuthService,
    private readonly campaignService: GoogleAdsCampaignService,
  ) {}

  @Post('auth/start')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting a Google Ads account',
    description:
      "Returns a short-lived Google sign-in URL. Open it in the merchant's browser. After " +
      'consent Google calls GET /auth/google-ads/callback, which stores one connection per ' +
      'advertiser account the user can access.',
  })
  @ApiOkResponse({ type: GoogleAdsAuthStartResponseDto })
  @ApiNotFoundResponse({
    description: 'The current user has not created a Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Google Ads is not enabled or configured.',
    type: ApiErrorDto,
  })
  begin(
    @CurrentUser() user: JwtPayload,
  ): Promise<GoogleAdsAuthStartResponseDto> {
    return this.authService.begin(user.userId);
  }

  @Get('campaigns/:connectionId')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List campaigns for "Select Campaigns"',
    description:
      'refresh=true re-fetches the live list from Google first; otherwise returns the last-known list.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  @ApiOkResponse({ type: GoogleCampaignListResponseDto })
  @ApiNotFoundResponse({
    description: 'Connection not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Reconnect Google Ads before using this feature.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'Google denied access (message from Google).',
    type: ApiErrorDto,
  })
  listCampaigns(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Query('refresh') refresh?: string,
  ): Promise<GoogleCampaignListResponseDto> {
    return refresh === 'true'
      ? this.campaignService.refreshAndList(user.userId, connectionId)
      : this.campaignService.list(user.userId, connectionId);
  }

  @Post('campaigns/:connectionId/selection')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Save which campaigns to track ("Save Campaigns")',
    description:
      'Only tracked campaigns are synced and shown on the dashboard.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiOkResponse({ type: GoogleCampaignListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.', type: ApiErrorDto })
  @ApiNotFoundResponse({
    description: 'Connection not found.',
    type: ApiErrorDto,
  })
  saveSelection(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() dto: SaveGoogleCampaignSelectionDto,
  ): Promise<GoogleCampaignListResponseDto> {
    return this.campaignService.saveSelection(
      user.userId,
      connectionId,
      dto.externalCampaignIds,
    );
  }

  @Post('campaigns/:connectionId/:externalCampaignId/status')
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pause or resume a campaign on Google Ads',
    description:
      'PAUSED stops the ads immediately on Google. ENABLED resumes them.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiParam({
    name: 'externalCampaignId',
    description: 'Google campaign id (digits).',
  })
  @ApiOkResponse({ type: GoogleCampaignDto })
  @ApiBadRequestResponse({
    description: 'Invalid status or campaign id.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Connection or campaign not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Reconnect Google Ads before using this feature.',
    type: ApiErrorDto,
  })
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Param('externalCampaignId') externalCampaignId: string,
    @Body() dto: SetGoogleCampaignStatusDto,
  ): Promise<GoogleCampaignDto> {
    return this.campaignService.setStatus(
      user.userId,
      connectionId,
      externalCampaignId,
      dto.status,
    );
  }
}
