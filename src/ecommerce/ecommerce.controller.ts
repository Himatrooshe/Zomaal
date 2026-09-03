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
  Res,
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
  EcommerceMetricsRefreshDto,
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
  EcommerceOrderProductsDto,
  ScannedShipmentResponseDto,
  RecordedProductConditionResponseDto,
  OrderFinancialSummaryDto,
  FinancialSyncResultDto,
} from './dto/ecommerce-order-response.dto';
import { RecordProductConditionDto } from './dto/record-product-condition.dto';
import { CreateManualOrderDto } from './dto/create-manual-order.dto';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import {
  EcommerceDispatchDto,
  EcommerceDispatchResponseDto,
} from './dto/ecommerce-dispatch.dto';
import { EcommerceSyncService } from './ecommerce-sync.service';
import { EcommerceService } from './ecommerce.service';
import { EcommerceMetricsService } from './ecommerce-metrics.service';
import { EcommerceHomeResponseDto } from './dto/ecommerce-home-response.dto';
import { OrderStatusSummaryResponseDto } from './dto/order-status-summary.dto';
import { ReturnsSummaryResponseDto } from './dto/returns-summary.dto';
import { EcommerceOrderTimelineService } from './ecommerce-order-timeline.service';
import { OrderTimelineDto } from './dto/order-timeline.dto';
import { ScanShipmentQueryDto } from './dto/scan-shipment-query.dto';
import { BarcodeLabelService } from '../warehouse/barcode-label.service';
import {
  BarcodeLabelFormat,
  BarcodeLabelQueryDto,
  BarcodeLabelTemplate,
} from '../warehouse/dto/barcode.dto';
import type { Response } from 'express';

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
    private readonly metricsService: EcommerceMetricsService,
    private readonly timelineService: EcommerceOrderTimelineService,
    private readonly labels: BarcodeLabelService,
    private readonly financialService: EcommerceOrderFinancialService,
  ) {}

  @Get('home')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get the consolidated e-commerce home-screen payload',
    description:
      'Returns revenue, actionable order states, cached product/customer totals, warehouse totals, shipping state, connection health, and recent orders in one request. The default period is the current calendar month in the requested timezone.',
  })
  @ApiOkResponse({
    type: EcommerceHomeResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid date range or timezone.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getHome(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<EcommerceHomeResponseDto> {
    return this.ecommerceService.getHome(user.userId, query);
  }

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

  @Post('connections/:connectionId/metrics/refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Refresh product and customer totals for one account',
    description:
      'Reads provider counts for the home screen without persisting customer records or customer PII.',
  })
  @ApiParam({
    name: 'connectionId',
    description: 'ID returned by GET /ecommerce/connections.',
    format: 'uuid',
  })
  @ApiOkResponse({ type: EcommerceMetricsRefreshDto })
  @ApiBadRequestResponse({
    description: 'connectionId is not a valid UUID.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  refreshMetrics(
    @CurrentUser() user: JwtPayload,
    @Param('connectionId', new ParseUUIDPipe()) connectionId: string,
  ): Promise<EcommerceMetricsRefreshDto> {
    return this.metricsService.refreshConnectionMetrics(
      user.userId,
      connectionId,
    );
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

  @Get('orders/status-summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get order counts and value by fulfillment/courier outcome',
    description:
      'Backs the Orders screen status tiles (Delivered / In Delivery / Refused / Canceled). ' +
      '"confirmed" is every non-cancelled order in the period (payment status is not used — ' +
      'COD orders stay unpaid until the courier collects on delivery); ' +
      'the other buckets read the normalized status of the courier shipment dispatched via ' +
      'Sendit/QuickLivraison/ForceLog/OzoneExpress. Orders never dispatched through one of ' +
      'our courier integrations (a 3rd-party plugin or manual fulfillment) only ever count ' +
      'toward "confirmed" or "cancelled" (via order.status). Defaults to the current calendar month.',
  })
  @ApiOkResponse({
    type: OrderStatusSummaryResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid date range or timezone.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getOrderStatusSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<OrderStatusSummaryResponseDto> {
    return this.ecommerceService.getOrderStatusSummary(user.userId, query);
  }

  @Get('returns/summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get returned-item counts and value by outcome',
    description:
      'Backs the Returns screen tiles (Received / Pending / Damaged / Missing). Built from ' +
      'the per-line condition recorded via POST /ecommerce/orders/:orderId/condition — ' +
      '"pending" additionally reads the courier shipment status for orders whose return is ' +
      'in transit but not yet scanned. Defaults to the current calendar month, filtered by ' +
      "the parent order's processedAt.",
  })
  @ApiOkResponse({
    type: ReturnsSummaryResponseDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid date range or timezone.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getReturnsSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<ReturnsSummaryResponseDto> {
    return this.ecommerceService.getReturnsSummary(user.userId, query);
  }

  @Post('orders/manual')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an order from a non-platform source',
    description:
      'For WhatsApp/phone/in-person orders — anything that never touched ' +
      'Shopify/YouCan/Lightfunnels. Products are resolved by Product ' +
      'Tracking Code (must already exist in the warehouse catalog) and ' +
      'customer info is captured directly, since there is no external ' +
      'platform to fetch it from later. Once created, this order goes ' +
      'through the exact same dispatch/timeline/financial-event pipeline as ' +
      'any synced order.',
  })
  @ApiOkResponse({ type: EcommerceOrderDto })
  @ApiBadRequestResponse({
    description: 'Invalid payload, or one or more product codes do not exist.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  createManualOrder(
    @CurrentUser() user: JwtPayload,
    @Body() payload: CreateManualOrderDto,
  ): Promise<EcommerceOrderDto> {
    return this.ecommerceService.createManualOrder(user.userId, payload);
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

  @Get('scan')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Resolve a scanned shipping barcode/QR to its order and products',
    description:
      'Accepts either a Zomaal-generated shipment QR (JSON payload) or a raw ' +
      "courier tracking number read off the carrier's own barcode — both " +
      'resolve to the same order. Camera decoding happens on the scanning ' +
      'device; this endpoint only ever receives the already-decoded text. ' +
      '`status` is always read live from the database, never from the scanned ' +
      'payload, since status changes after the code was printed.',
  })
  @ApiOkResponse({ type: ScannedShipmentResponseDto })
  @ApiBadRequestResponse({
    description: 'Scanned value is malformed or the QR JSON is invalid.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  scan(
    @CurrentUser() user: JwtPayload,
    @Query() query: ScanShipmentQueryDto,
  ): Promise<ScannedShipmentResponseDto> {
    return this.ecommerceService.resolveScannedCode(user.userId, query.value);
  }

  @Post('orders/:orderId/condition')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Record a returned product's condition",
    description:
      'Called after a warehouse scan identifies the order (see GET /ecommerce/scan). ' +
      'Records Good/Damaged/Lost/Returned/Missing for one product line and, for ' +
      'GOOD/RETURNED/DAMAGED, applies the matching inventory movement in the same ' +
      'call — GOOD/RETURNED restock on-hand, DAMAGED moves to the damaged bucket. ' +
      'LOST/MISSING create no movement since nothing physical came back. ' +
      'Re-recording the same condition twice is a no-op; recording a different ' +
      'condition for the same line applies a new correction movement.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({ type: RecordedProductConditionResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format or invalid condition payload.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'Order not found, or no line on this order matches the given product code.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  recordCondition(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Body() payload: RecordProductConditionDto,
  ): Promise<RecordedProductConditionResponseDto> {
    return this.ecommerceService.recordProductCondition(
      user.userId,
      orderId,
      payload,
    );
  }

  @Get('orders/:orderId/financials')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: "Get an order's financial summary",
    description:
      'Sums the append-only financial event ledger for this order — revenue ' +
      'is 0 until the carrier marks the shipment DELIVERED (see ' +
      'POST .../financials/sync), and stays 0 forever if it never is. ' +
      'damageCost reflects any DAMAGED conditions recorded via ' +
      'POST .../condition. Always 200 — an order with no events yet simply ' +
      'returns all-zero totals and an empty events array.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({ type: OrderFinancialSummaryDto })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getOrderFinancials(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<OrderFinancialSummaryDto> {
    return this.financialService.getSummary(user.userId, orderId);
  }

  @Post('orders/:orderId/financials/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Re-check the order's carrier status and apply financial events",
    description:
      "Reads whichever courier shipment is linked to this order's dispatch " +
      '(Sendit/QuickLivraison/ForceLog/OzoneExpress) and, if its live status ' +
      'is DELIVERED or a terminal failure (CANCELLED/REFUSED/' +
      'RETURNED_TO_SELLER), applies the matching revenue event. Idempotent — ' +
      'safe to call repeatedly. Note: this is a manual/on-demand trigger; ' +
      'it does not yet fire automatically from courier sync or webhooks — ' +
      'call it (or poll it) after dispatch to keep financials current.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({ type: FinancialSyncResultDto })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  syncOrderFinancials(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<FinancialSyncResultDto> {
    return this.financialService.syncFromDispatch(user.userId, orderId);
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

  @Get('orders/:orderId/products')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'View all product lines on a synchronized order',
    description:
      'Fetches the current order product lines directly from Shopify, YouCan, or Lightfunnels and returns one provider-neutral response.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID returned by GET /ecommerce/orders',
    format: 'uuid',
  })
  @ApiOkResponse({
    type: EcommerceOrderProductsDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format or unsupported platform.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The source-platform connection is not active.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The source-platform token lacks order-read access.',
    type: ApiErrorDto,
  })
  @ApiBadGatewayResponse({
    description: 'The source platform returned an invalid order response.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getOrderProducts(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
  ): Promise<EcommerceOrderProductsDto> {
    return this.ecommerceService.getOrderProducts(user.userId, orderId);
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

  @Get('orders/:orderId/shipping-qr')
  @ApiOperation({
    summary: "Render the order's shipment QR sticker",
    description:
      'Renders a QR label Zomaal prints and attaches to the parcel — separate ' +
      "from the carrier's own label. Encodes { productCode, orderId, " +
      'trackingNumber } (or a PACK/ORDER envelope for bundles and multi-line ' +
      'orders) so a later scan resolves the order and products without a ' +
      'network round trip. Only available after dispatch, once a tracking ' +
      'number exists.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description:
      'Binary PDF or UTF-8 SVG QR label, selected by the format query.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
      'image/svg+xml': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Order has not been dispatched yet, or has no product-code-linked lines.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  @ApiProduces('application/pdf', 'image/svg+xml')
  async shippingQr(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Query() query: BarcodeLabelQueryDto,
    @Res() response: Response,
  ) {
    const payload = await this.ecommerceService.getShipmentQrPayload(
      user.userId,
      orderId,
    );
    const template = query.template ?? BarcodeLabelTemplate.THERMAL_60X40;
    const subtitle =
      payload.type === 'PACK'
        ? `Pack · ${payload.items.length} items`
        : payload.trackingNumber;
    const title =
      payload.type === 'PRODUCT'
        ? payload.productCode
        : payload.type === 'PACK'
          ? payload.packCode
          : payload.orderId;

    if (query.format === BarcodeLabelFormat.SVG) {
      const body = this.labels.renderQrSvg(
        JSON.stringify(payload),
        title,
        subtitle,
        template,
      );
      response.set({
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Content-Disposition': `inline; filename="shipping-qr-${orderId}.svg"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.send(body);
      return;
    }
    const body = await this.labels.renderQrPdf(
      JSON.stringify(payload),
      title,
      subtitle,
      template,
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="shipping-qr-${orderId}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(body);
  }

  @Get('orders/:orderId/timeline')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get the event timeline for an order',
    description:
      'Returns all order lifecycle and shipping events sourced from the connected e-commerce platform. ' +
      'Works regardless of which shipping carrier or plugin the merchant uses, as long as the platform ' +
      'reflects the shipment updates. Pass ?refresh=true to re-fetch from the platform; otherwise cached ' +
      'events are returned. Always returns 200 — check `available` to determine whether events exist.',
  })
  @ApiParam({
    name: 'orderId',
    description: 'Zomaal internal order ID',
    format: 'uuid',
  })
  @ApiOkResponse({
    description: 'Order timeline. `available: false` when no events exist yet.',
    type: OrderTimelineDto,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
  @ApiBadRequestResponse({
    description: 'Invalid order ID format.',
    type: ApiErrorDto,
  })
  @ApiRevenueReadErrors()
  getOrderTimeline(
    @CurrentUser() user: JwtPayload,
    @Param('orderId', new ParseUUIDPipe()) orderId: string,
    @Query('refresh') refresh?: string,
  ): Promise<OrderTimelineDto> {
    return this.timelineService.getTimeline(
      user.userId,
      orderId,
      refresh === 'true',
    );
  }

  @Post('orders/timeline/backfill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Backfill synthetic timeline events for existing YouCan/Lightfunnels orders',
    description:
      'One-time operation. Generates synthetic events from stored timestamps for all ' +
      'YouCan/Lightfunnels orders that have no timeline events yet. Idempotent — safe to call multiple times.',
  })
  @ApiOkResponse({
    description: 'Backfill result.',
    schema: {
      type: 'object',
      properties: {
        processed: {
          type: 'number',
          description: 'Orders that received synthetic events',
        },
        skipped: {
          type: 'number',
          description: 'Orders that failed to backfill',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid token.',
    type: ApiErrorDto,
  })
  backfillTimelines(): Promise<{ processed: number; skipped: number }> {
    return this.timelineService.backfillAllOrders();
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
