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
  MetaAdsAuthStartResponseDto,
  MetaCampaignDto,
  MetaCampaignListResponseDto,
  SaveMetaCampaignSelectionDto,
  SetMetaCampaignStatusDto,
} from '../dto/meta-ads.dto';
import { MetaAdsAuthService } from './meta-ads-auth.service';
import { MetaAdsCampaignService } from './meta-ads-campaign.service';

@ApiTags('Ads — Meta')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@RequirePlanFeature(PLAN_FEATURES.ADS)
@Controller('ads/meta')
export class MetaAdsController {
  constructor(
    private readonly authService: MetaAdsAuthService,
    private readonly campaignService: MetaAdsCampaignService,
  ) {}

  @Post('auth/start')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting Meta ad accounts (Facebook / Instagram)',
    description:
      "Returns a short-lived Facebook sign-in URL. Open it in the merchant's browser. After " +
      'consent Facebook calls GET /auth/meta-ads/callback, which stores one connection per ' +
      'active ad account the user can access.',
  })
  @ApiOkResponse({ type: MetaAdsAuthStartResponseDto })
  @ApiNotFoundResponse({
    description: 'The current user has not created a Zomaal store.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Meta Ads is not enabled or configured.',
    type: ApiErrorDto,
  })
  begin(@CurrentUser() user: JwtPayload): Promise<MetaAdsAuthStartResponseDto> {
    return this.authService.begin(user.userId);
  }

  @Get('campaigns/:connectionId')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List campaigns for "Select Campaigns"',
    description:
      'refresh=true re-fetches the live list from Meta first; otherwise returns the last-known list.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiQuery({ name: 'refresh', required: false, type: Boolean })
  @ApiOkResponse({ type: MetaCampaignListResponseDto })
  @ApiNotFoundResponse({
    description: 'Connection not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Reconnect Meta Ads before using this feature.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'Meta denied access (message from Meta).',
    type: ApiErrorDto,
  })
  listCampaigns(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Query('refresh') refresh?: string,
  ): Promise<MetaCampaignListResponseDto> {
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
  @ApiOkResponse({ type: MetaCampaignListResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload.', type: ApiErrorDto })
  @ApiNotFoundResponse({
    description: 'Connection not found.',
    type: ApiErrorDto,
  })
  saveSelection(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Body() dto: SaveMetaCampaignSelectionDto,
  ): Promise<MetaCampaignListResponseDto> {
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
    summary: 'Pause or resume a campaign on Meta',
    description:
      'PAUSED stops the ads immediately on Facebook / Instagram. ACTIVE resumes them.',
  })
  @ApiParam({ name: 'connectionId', format: 'uuid' })
  @ApiParam({
    name: 'externalCampaignId',
    description: 'Meta campaign id (digits).',
  })
  @ApiOkResponse({ type: MetaCampaignDto })
  @ApiBadRequestResponse({
    description: 'Invalid status or campaign id.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description:
      'The merchant did not allow managing ads, or Meta denied the change.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Connection or campaign not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Reconnect Meta Ads before using this feature.',
    type: ApiErrorDto,
  })
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
    @Param('externalCampaignId') externalCampaignId: string,
    @Body() dto: SetMetaCampaignStatusDto,
  ): Promise<MetaCampaignDto> {
    return this.campaignService.setStatus(
      user.userId,
      connectionId,
      externalCampaignId,
      dto.status,
    );
  }
}
