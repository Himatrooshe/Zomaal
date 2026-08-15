import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import {
  SharedConnectionStatusDto,
  SharedOverviewQueryDto,
  SharedOverviewResponseDto,
  SharedShipmentDetailDto,
  SharedShipmentListDto,
  SharedShipmentQueryDto,
  SharedSyncResultDto,
  SharedSyncQueryDto,
  SharedTimelineDto,
  ShippingProvider,
} from './dto/shipping-provider.dto';
import { ShippingProviderService } from './shipping-provider.service';

@ApiTags('Shipping - Shared Providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('shipping/providers/:provider')
@ApiParam({ name: 'provider', enum: ShippingProvider })
export class ShippingProviderController {
  constructor(private readonly providers: ShippingProviderService) {}

  @Get('connection')
  @ApiOperation({ summary: 'Get normalized courier connection status' })
  @ApiOkResponse({ type: SharedConnectionStatusDto })
  connection(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
  ) {
    return this.providers.connection(user.userId, provider);
  }

  @Get('shipments')
  @ApiOperation({ summary: 'List normalized courier shipments' })
  @ApiOkResponse({ type: SharedShipmentListDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
    @Query() query: SharedShipmentQueryDto,
  ) {
    return this.providers.list(user.userId, provider, query);
  }

  @Post('sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Run normalized manual courier synchronization' })
  @ApiOkResponse({ type: SharedSyncResultDto })
  sync(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
    @Query() query: SharedSyncQueryDto,
  ) {
    return this.providers.sync(user.userId, provider, query);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Get normalized courier analytics' })
  @ApiOkResponse({ type: SharedOverviewResponseDto })
  overview(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
    @Query() query: SharedOverviewQueryDto,
  ) {
    return this.providers.overview(user.userId, provider, query);
  }

  @Get('shipments/:code/timeline')
  @ApiOperation({ summary: 'Get a normalized shipment timeline' })
  @ApiOkResponse({ type: SharedTimelineDto })
  timeline(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
    @Param('code') code: string,
  ) {
    return this.providers.timeline(user.userId, provider, code);
  }

  @Get('shipments/:code')
  @ApiOperation({ summary: 'Get normalized shipment details' })
  @ApiOkResponse({ type: SharedShipmentDetailDto })
  detail(
    @CurrentUser() user: JwtPayload,
    @Param('provider', new ParseEnumPipe(ShippingProvider))
    provider: ShippingProvider,
    @Param('code') code: string,
  ) {
    return this.providers.detail(user.userId, provider, code);
  }
}
