import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiPropertyOptional,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { EcommercePlatform } from '@prisma/client';
import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import { type IntegrationHealth, PlatformService } from './platform.service';

const HEALTH_VALUES: IntegrationHealth[] = [
  'HEALTHY',
  'STALE',
  'ERROR',
  'DISCONNECTED',
];

export class ListIntegrationsQueryDto {
  @ApiPropertyOptional({ enum: HEALTH_VALUES })
  @IsOptional()
  @IsIn(HEALTH_VALUES)
  health?: IntegrationHealth;

  @ApiPropertyOptional({
    enum: [
      EcommercePlatform.SHOPIFY,
      EcommercePlatform.YOUCAN,
      EcommercePlatform.LIGHTFUNNELS,
    ],
  })
  @IsOptional()
  @IsIn([
    EcommercePlatform.SHOPIFY,
    EcommercePlatform.YOUCAN,
    EcommercePlatform.LIGHTFUNNELS,
  ])
  platform?: EcommercePlatform;
}

export class ListBlacklistQueryDto {
  @ApiPropertyOptional({ description: 'Match on phone or customer name.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: '"true" = only phones blacklisted by 2+ merchants.',
  })
  @IsOptional()
  @IsBooleanString()
  multiStoreOnly?: string;
}

@ApiTags('Admin Platform Oversight')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('dashboard/summary')
  @ApiOperation({
    summary:
      'Dashboard: catalog, merchant, order, integration and blacklist KPIs, signups trend, recent admin activity',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  dashboard() {
    return this.platform.dashboard();
  }

  @Get('integrations')
  @ApiOperation({
    summary:
      "Every merchant's Shopify/YouCan/Lightfunnels connection, with health",
    description:
      'health: ERROR (last sync failed), STALE (no successful sync in 48h), DISCONNECTED (not ACTIVE), HEALTHY. Read-only.',
  })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  integrations(@Query() query: ListIntegrationsQueryDto) {
    return this.platform.integrations(query);
  }

  @Get('customers/blacklisted')
  @ApiOperation({
    summary: 'Blacklisted customers across all merchants',
    description:
      'flaggedByStores = how many different merchants blacklisted the same phone. Read-only.',
  })
  @ApiOkResponse({ schema: { type: 'object' } })
  blacklist(@Query() query: ListBlacklistQueryDto) {
    return this.platform.blacklist({
      search: query.search,
      multiStoreOnly: query.multiStoreOnly === 'true',
    });
  }
}
