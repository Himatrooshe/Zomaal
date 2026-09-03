import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { RevenueRangeQueryDto } from '../ecommerce/dto/revenue-query.dto';
import { AdSpendService } from './ad-spend.service';
import {
  AdSpendListDto,
  AdSpendListQueryDto,
  AdSpendSummaryResponseDto,
} from './dto/ad-spend.dto';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description: 'Ad spend data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

// Read-only on purpose. No Meta/TikTok/Google/Snapchat account connection
// exists yet, so there is no legitimate way for a number to land in
// AdSpendEntry — these endpoints will always report available: false /
// all-zero tiles until a real OAuth-connected ads module (same shape as
// ShopifyConnection/SenditConnection) starts writing here.
@ApiTags('Finance — Advertising')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('finance/ad-spend')
export class AdSpendController {
  constructor(private readonly adSpendService: AdSpendService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List ad spend entries',
    description:
      'Always returns an empty list today — no ad platform account is connected yet. ' +
      'Reserved for when a real Meta/TikTok/Google/Snapchat integration exists.',
  })
  @ApiOkResponse({ type: AdSpendListDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.', type: ApiErrorDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: AdSpendListQueryDto,
  ): Promise<AdSpendListDto> {
    return this.adSpendService.list(user.userId, query);
  }

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get ad spend and results by platform',
    description:
      'Backs the Advertising screen tiles (Meta / TikTok / Google / Snapchat Ads). ' +
      'available is always false today — no ad platform account is connected, so every ' +
      'number is 0, never a placeholder or manually entered value. Defaults to the current ' +
      'calendar month.',
  })
  @ApiOkResponse({ type: AdSpendSummaryResponseDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid date range or timezone.', type: ApiErrorDto })
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<AdSpendSummaryResponseDto> {
    return this.adSpendService.getSummary(user.userId, query);
  }
}
