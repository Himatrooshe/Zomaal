import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  ShippingHomeQueryDto,
  ShippingHomeResponseDto,
} from './dto/shipping-home.dto';
import { ShippingDashboardService } from './shipping-dashboard.service';

@ApiTags('Shipping Overview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping')
export class ShippingDashboardController {
  constructor(private readonly dashboard: ShippingDashboardService) {}

  @Get('home')
  @ApiOperation({
    summary: 'Get unified shipping home metrics',
    description:
      'Combines locally tracked Sendit and QuickLivraison shipments for Today, 7, 30, or 90 days. Costs use stored courier fees only. The response reports priced-shipment coverage so the frontend can identify partial provider fee data.',
  })
  @ApiOkResponse({
    description: 'Unified shipping costs and shipment counts in MAD.',
    type: ShippingHomeResponseDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing, invalid, expired, or non-access bearer token.',
    type: ApiErrorDto,
  })
  getHome(
    @CurrentUser() user: JwtPayload,
    @Query() query: ShippingHomeQueryDto,
  ) {
    return this.dashboard.getHome(user.userId, query);
  }
}
