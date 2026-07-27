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
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  EcommerceConnectionListDto,
  EcommerceSyncResponseDto,
  RevenueSummaryDto,
  RevenueTimeseriesDto,
} from './dto/ecommerce-response.dto';
import { RevenueRangeQueryDto } from './dto/revenue-query.dto';
import { EcommerceOrderQueryDto } from './dto/ecommerce-order-query.dto';
import {
  EcommerceOrderDto,
  EcommerceOrderListDto,
  EcommerceFulfillmentPreviewDto,
} from './dto/ecommerce-order-response.dto';
import {
  EcommerceDispatchDto,
  EcommerceDispatchResponseDto,
} from './dto/ecommerce-dispatch.dto';
import { EcommerceSyncService } from './ecommerce-sync.service';
import { EcommerceService } from './ecommerce.service';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description:
      'Revenue and connection data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

@ApiTags('E-commerce Revenue')
@ApiProduces('application/json')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ecommerce')
export class EcommerceController {
  constructor(
    private readonly ecommerceService: EcommerceService,
    private readonly syncService: EcommerceSyncService,
  ) {}

  @Get('connections')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List connected e-commerce accounts',
    description:
      'Returns provider-neutral connection and synchronization state for the current Zomaal store. Provider credentials are never exposed.',
  })
  @ApiOkResponse({
    description: 'Connected accounts, including disconnected history.',
    type: EcommerceConnectionListDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiRevenueReadErrors()
  listConnections(
    @CurrentUser() user: JwtPayload,
  ): Promise<EcommerceConnectionListDto> {
    return this.ecommerceService.listConnections(user.userId);
  }

  @Post('connections/:connectionId/sync')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Synchronize order revenue from one account',
    description:
      'Fetches at most five Shopify, YouCan, or Lightfunnels pages and upserts normalized, non-PII order financials. If `hasMore` is true, call this operation again; synchronization resumes from the saved provider cursor.',
  })
  @ApiParam({
    name: 'connectionId',
    description: 'ID returned by `GET /ecommerce/connections`.',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Synchronization chunk completed.',
    type: EcommerceSyncResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: '`connectionId` is not a valid UUID.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid Zomaal access token.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'The connection does not exist or does not belong to the current user.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The provider account must be reconnected before syncing.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description:
      'The provider token is missing a required order-read permission. Reconnect with the documented scopes.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description:
      'Shopify, YouCan, or Lightfunnels returned malformed order, monetary, or pagination data.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description:
      'The selected provider is throttled or temporarily unavailable.',
    type: ApiErrorDto,
  })
  syncConnection(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
  ): Promise<EcommerceSyncResponseDto> {
    return this.syncService.syncConnection(user.userId, connectionId);
  }

  @Get('revenue/summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get combined revenue totals',
    description:
      'Dynamically combines synchronized Shopify, YouCan, and Lightfunnels accounts by platform and currency. Different currencies are never added together. Date boundaries are inclusive and evaluated in the requested timezone.',
  })
  @ApiOkResponse({
    description: 'Revenue totals and data freshness watermark.',
    type: RevenueSummaryDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid calendar date, date order, timezone, or unexpected query parameter.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<RevenueSummaryDto> {
    return this.ecommerceService.getRevenueSummary(user.userId, query);
  }

  @Get('revenue/timeseries')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get daily combined revenue',
    description:
      'Returns daily totals across synchronized Shopify, YouCan, and Lightfunnels accounts, grouped by currency. Defaults to the latest 30 calendar days and accepts at most 366 days per request.',
  })
  @ApiOkResponse({
    description: 'Daily revenue totals. Dates with no orders are omitted.',
    type: RevenueTimeseriesDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid calendar date, date order, timezone, range over 366 days, or unexpected query parameter.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getTimeseries(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<RevenueTimeseriesDto> {
    return this.ecommerceService.getRevenueTimeseries(user.userId, query);
  }

  @Get('orders')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List synchronized e-commerce orders',
    description:
      'Returns orders synchronized from all connected platforms. Cancelled and refunded orders are excluded by default.',
  })
  @ApiOkResponse({ type: EcommerceOrderListDto })
  @ApiBadRequestResponse({
    description: 'Invalid query parameters.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  listOrders(
    @CurrentUser() user: JwtPayload,
    @Query() query: EcommerceOrderQueryDto,
  ): Promise<EcommerceOrderListDto> {
    return this.ecommerceService.listOrders(user.userId, query);
  }

  @Get('orders/:orderId')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get details of a synchronized e-commerce order',
    description:
      'Returns the details of a specific order synchronized from connected platforms.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Order details.',
    type: EcommerceOrderDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getOrder(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<EcommerceOrderDto> {
    return this.ecommerceService.getOrder(user.userId, orderId);
  }

  @Get('orders/:orderId/fulfillment-preview')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Fetch live fulfillment details',
    description:
      'Fetches live recipient, address, and unfulfilled line item details from the source platform.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: EcommerceFulfillmentPreviewDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getFulfillmentPreview(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<EcommerceFulfillmentPreviewDto> {
    return this.ecommerceService.getFulfillmentPreview(user.userId, orderId);
  }

  @Post('orders/:orderId/dispatch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch an order to a courier',
    description:
      'Creates a parcel for the order using the selected shipping provider. This operation is idempotent.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({ type: EcommerceDispatchResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format or invalid dispatch payload.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  dispatchOrder(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() payload: EcommerceDispatchDto,
  ): Promise<EcommerceDispatchResponseDto> {
    return this.ecommerceService.dispatchOrder(user.userId, orderId, payload);
  }
}

function ApiRevenueReadErrors() {
  return applyDecorators(
    ApiUnauthorizedResponse({
      description: 'Missing or invalid Zomaal access token.',
      type: ApiErrorDto,
    }),
    ApiNotFoundResponse({
      description: 'The current user has not created a Zomaal store.',
      type: ApiErrorDto,
    }),
  );
}
