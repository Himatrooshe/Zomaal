import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { PermissionGuard } from '../../access/permission.guard';
import { RequirePermission } from '../../access/require-permission.decorator';
import { PERMISSIONS } from '../../access/permissions';
import { RequirePlanFeature } from '../../billing/billing.decorators';
import {
  SnapchatCampaignSelectionDto,
  SnapchatMetricsQueryDto,
} from '../dto/snapchat-ads.dto';
import { SnapchatAdsAuthService } from './snapchat-ads-auth.service';
import { SnapchatAdsService } from './snapchat-ads.service';

@ApiTags('Ads — Snapchat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@RequirePlanFeature('ads')
@Controller('ads/snapchat')
export class SnapchatAdsController {
  constructor(
    private readonly auth: SnapchatAdsAuthService,
    private readonly ads: SnapchatAdsService,
  ) {}
  @Post('auth/start')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Start Snapchat Marketing API OAuth; open the returned URL in the merchant browser',
  })
  begin(@CurrentUser() user: JwtPayload) {
    return this.auth.begin(user.userId);
  }

  @Get('campaigns/:connectionId')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Read cached Snapchat campaigns. Provider refresh uses the separate management endpoint.',
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', ParseUUIDPipe) id: string,
  ) {
    return this.ads.list(user.userId, id);
  }

  @Post('campaigns/:connectionId/refresh')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Refresh the local campaign mirror from Snapchat; does not change ads or spend',
  })
  refresh(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', ParseUUIDPipe) id: string,
  ) {
    return this.ads.list(user.userId, id, true);
  }

  @Post('campaigns/:connectionId/selection')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Select campaigns for Zomaal reporting; does not change Snapchat campaigns',
  })
  select(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', ParseUUIDPipe) id: string,
    @Body() dto: SnapchatCampaignSelectionDto,
  ) {
    return this.ads.select(user.userId, id, dto.externalCampaignIds);
  }

  @Post('sync/:connectionId')
  @HttpCode(200)
  @RequirePermission(PERMISSIONS.ADS_MANAGE)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Read real Snapchat daily reports into tracked campaign snapshots; first sync backfills 90 days',
  })
  sync(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', ParseUUIDPipe) id: string,
  ) {
    return this.ads.syncForUser(user.userId, id);
  }

  @Get('metrics/:connectionId')
  @RequirePermission(PERMISSIONS.ADS_VIEW)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary:
      'Read Snapchat spend, swipes, impressions and purchases in account currency/timezone',
    description:
      'Results mean conversion_purchases; attribution uses conversion time, 28-day swipe and 1-day view. Multi-day reach is not added.',
  })
  metrics(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', ParseUUIDPipe) id: string,
    @Query() query: SnapchatMetricsQueryDto,
  ) {
    return this.ads.metrics(user.userId, id, query.days ?? 7);
  }
}

@ApiTags('Ads — Snapchat OAuth')
@Controller('auth/snapchat-ads')
export class SnapchatAdsOAuthController {
  constructor(private readonly auth: SnapchatAdsAuthService) {}
  @Get('callback')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Snapchat browser OAuth callback; consumes single-use state and stores encrypted credentials',
  })
  async callback(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.auth.complete(query);
      const redirect = this.auth.redirect('connected');
      if (redirect) {
        response.redirect(302, redirect);
        return;
      }
      return result;
    } catch (error) {
      const redirect = this.auth.redirect('failed');
      if (redirect) {
        response.redirect(302, redirect);
        return;
      }
      throw error;
    }
  }
}
