import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ShopifyFulfillmentAdapter } from './shopify-fulfillment.adapter';
import { YouCanFulfillmentAdapter } from './youcan-fulfillment.adapter';
import { LightfunnelsFulfillmentAdapter } from './lightfunnels-fulfillment.adapter';
import { CurrencyService } from '../currency/currency.service';
import { EcommerceOrderQueryDto } from './dto/ecommerce-order-query.dto';
import {
  EcommerceDispatchDto,
  EcommerceDispatchResponseDto,
  ShippingProvider,
} from './dto/ecommerce-dispatch.dto';
import {
  EcommerceOrderListDto,
  EcommerceFulfillmentPreviewDto,
  EcommerceOrderProductsDto,
} from './dto/ecommerce-order-response.dto';
import { EcommercePlatform } from '@prisma/client';
import type {
  EcommerceConnectionListDto,
  RevenueAmountsDto,
  RevenueCurrencyTotalDto,
  RevenuePlatformTotalDto,
  RevenueSummaryDto,
  RevenueTimeseriesDto,
} from './dto/ecommerce-response.dto';
import type { RevenueRangeQueryDto } from './dto/revenue-query.dto';
import type { EcommerceHomeResponseDto } from './dto/ecommerce-home-response.dto';
import { ShippingService } from '../shipping/shipping.service';

const INCLUDED_PAYMENT_STATUSES = Prisma.sql`
  (
    'PARTIALLY_PAID'::"EcommercePaymentStatus",
    'PAID'::"EcommercePaymentStatus",
    'PARTIALLY_REFUNDED'::"EcommercePaymentStatus",
    'REFUNDED'::"EcommercePaymentStatus"
  )
`;
const MAX_TIMESERIES_DAYS = 366;

interface AggregateRow {
  platform?: string;
  date?: Date | string;
  currency: string;
  orderCount: number | bigint;
  grossSales: Prisma.Decimal;
  discounts: Prisma.Decimal;
  refunds: Prisma.Decimal;
  netSales: Prisma.Decimal;
  shipping: Prisma.Decimal;
  tax: Prisma.Decimal;
  totalCollected: Prisma.Decimal;
}

interface HomeOrderMetricsRow {
  total: number | bigint;
  inPeriod: number | bigint;
  open: number | bigint;
  unfulfilled: number | bigint;
  readyToDispatch: number | bigint;
  dispatched: number | bigint;
  cancelled: number | bigint;
  refunded: number | bigint;
  dispatchTotal: number | bigint;
  dispatchPending: number | bigint;
  dispatchFailed: number | bigint;
}

@Injectable()
export class EcommerceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyFulfillmentAdapter: ShopifyFulfillmentAdapter,
    private readonly youCanFulfillmentAdapter: YouCanFulfillmentAdapter,
    private readonly lightfunnelsFulfillmentAdapter: LightfunnelsFulfillmentAdapter,
    private readonly currencyService: CurrencyService,
    private readonly shippingService: ShippingService,
  ) {}

  async listConnections(userId: string): Promise<EcommerceConnectionListDto> {
    const store = await this.requireStore(userId);
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId: store.id },
      include: {
        shopifyConnection: {
          select: { lastWebhookAt: true, lastWebhookError: true },
        },
      },
      orderBy: [{ platform: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      data: connections.map((connection) => ({
        id: connection.id,
        platform: connection.platform,
        externalAccountId: connection.externalAccountId,
        displayName: connection.displayName,
        status: connection.status,
        includeInRevenue: connection.includeInRevenue,
        lastSyncedAt: connection.lastSyncedAt?.toISOString() ?? null,
        syncPending: connection.syncStartedAt !== null,
        lastSyncError: connection.lastSyncError,
        productCount: connection.productCount,
        customerCount: connection.customerCount,
        metricsSyncedAt: connection.metricsSyncedAt?.toISOString() ?? null,
        lastMetricsError: connection.lastMetricsError,
        lastWebhookAt:
          connection.shopifyConnection?.lastWebhookAt?.toISOString() ?? null,
        lastWebhookError:
          connection.shopifyConnection?.lastWebhookError ?? null,
      })),
    };
  }

  async getHome(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<EcommerceHomeResponseDto> {
    const store = await this.requireStore(userId);
    const homeQuery = defaultHomeRange(query);
    const range = validateRange(homeQuery);
    const dateFilter = buildDateFilter(range);

    const [
      revenue,
      orderRows,
      connectionsResult,
      recentOrders,
      warehouse,
      shippingConnections,
    ] = await Promise.all([
      this.getRevenueSummary(userId, homeQuery),
      this.prisma.$queryRaw<HomeOrderMetricsRow[]>(Prisma.sql`
          SELECT
            COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE TRUE ${dateFilter})::int AS "inPeriod",
            COUNT(*) FILTER (WHERE orders."status" = 'OPEN')::int AS "open",
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(orders."fulfillmentStatus", '')) NOT IN ('fulfilled', 'restocked')
                AND orders."status" <> 'CANCELLED'
            )::int AS "unfulfilled",
            COUNT(*) FILTER (
              WHERE dispatch."id" IS NULL
                AND orders."status" <> 'CANCELLED'
                AND LOWER(COALESCE(orders."fulfillmentStatus", '')) NOT IN ('fulfilled', 'restocked')
            )::int AS "readyToDispatch",
            COUNT(*) FILTER (WHERE dispatch."status" = 'DISPATCHED')::int AS "dispatched",
            COUNT(*) FILTER (WHERE orders."status" = 'CANCELLED')::int AS "cancelled",
            COUNT(*) FILTER (
              WHERE orders."financialStatus" IN ('REFUNDED', 'PARTIALLY_REFUNDED')
            )::int AS "refunded",
            COUNT(dispatch."id")::int AS "dispatchTotal",
            COUNT(*) FILTER (WHERE dispatch."status" = 'PENDING')::int AS "dispatchPending",
            COUNT(*) FILTER (WHERE dispatch."status" = 'FAILED')::int AS "dispatchFailed"
          FROM "EcommerceOrder" orders
          INNER JOIN "EcommerceConnection" connection
            ON connection."id" = orders."connectionId"
          LEFT JOIN "EcommerceOrderDispatch" dispatch
            ON dispatch."orderId" = orders."id"
          WHERE connection."storeId" = ${store.id}
        `),
      this.listConnections(userId),
      this.listOrders(userId, {
        page: 1,
        limit: 5,
        includeCancelled: true,
        includeRefunded: true,
        includeDispatched: true,
      }),
      Promise.all([
        this.prisma.warehouseProduct.count({ where: { storeId: store.id } }),
        this.prisma.warehouseProduct.count({
          where: { storeId: store.id, status: 'ACTIVE' },
        }),
      ]),
      Promise.all([
        this.prisma.senditConnection.findUnique({ where: { userId } }),
        this.prisma.quickLivraisonConnection.findUnique({ where: { userId } }),
        this.prisma.forceLogConnection.findUnique({ where: { userId } }),
        this.prisma.ozoneExpressConnection.findUnique({ where: { userId } }),
      ]),
    ]);

    const row = orderRows[0] ?? emptyHomeOrderMetrics();
    const activeConnections = connectionsResult.data.filter(
      (connection) => connection.status === 'ACTIVE',
    );
    const metricDates = activeConnections
      .map((connection) => connection.metricsSyncedAt)
      .filter((value): value is string => value !== null)
      .sort();

    return {
      baseCurrency: store.baseCurrency,
      revenue,
      orders: {
        total: Number(row.total),
        inPeriod: Number(row.inPeriod),
        open: Number(row.open),
        unfulfilled: Number(row.unfulfilled),
        readyToDispatch: Number(row.readyToDispatch),
        dispatched: Number(row.dispatched),
        cancelled: Number(row.cancelled),
        refunded: Number(row.refunded),
      },
      catalog: {
        connectedProducts: activeConnections.reduce(
          (total, connection) => total + (connection.productCount ?? 0),
          0,
        ),
        connectedCustomers: activeConnections.reduce(
          (total, connection) => total + (connection.customerCount ?? 0),
          0,
        ),
        warehouseProducts: warehouse[0],
        activeWarehouseProducts: warehouse[1],
        complete:
          activeConnections.length > 0 &&
          activeConnections.every(
            (connection) =>
              connection.productCount !== null &&
              connection.customerCount !== null,
          ),
        metricsFreshAsOf: metricDates[0] ?? null,
      },
      shipping: {
        connectedProviders: shippingConnections.filter(Boolean).length,
        totalDispatches: Number(row.dispatchTotal),
        pending: Number(row.dispatchPending),
        dispatched: Number(row.dispatched),
        failed: Number(row.dispatchFailed),
      },
      connections: connectionsResult.data,
      recentOrders: recentOrders.data,
    };
  }

  async listOrders(
    userId: string,
    query: EcommerceOrderQueryDto,
  ): Promise<EcommerceOrderListDto> {
    const store = await this.requireStore(userId);
    const connectionFilter: Prisma.EcommerceConnectionWhereInput = {
      storeId: store.id,
    };

    if (query.platform) {
      connectionFilter.platform = query.platform;
    }

    if (query.includeInRevenue !== undefined) {
      connectionFilter.includeInRevenue = query.includeInRevenue;
    }

    const where: Prisma.EcommerceOrderWhereInput = {
      connection: connectionFilter,
    };

    if (query.financialStatus) {
      where.financialStatus = query.financialStatus;
    }

    if (query.fulfillmentStatus) {
      where.fulfillmentStatus = query.fulfillmentStatus;
    }

    if (query.search) {
      where.OR = [
        { externalOrderId: query.search },
        { orderName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (!query.includeCancelled) {
      where.status = { not: 'CANCELLED' };
    }

    if (!query.includeRefunded && !query.financialStatus) {
      where.financialStatus = { notIn: ['REFUNDED', 'PARTIALLY_REFUNDED'] };
    }

    if (!query.includeDispatched) {
      where.dispatch = { is: null };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;

    const [total, orders] = await Promise.all([
      this.prisma.ecommerceOrder.count({ where }),
      this.prisma.ecommerceOrder.findMany({
        where,
        orderBy: { processedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          connection: { select: { platform: true } },
          dispatch: true,
        },
      }),
    ]);

    return {
      data: orders.map((order) => ({
        id: order.id,
        externalOrderId: order.externalOrderId,
        orderName: order.orderName,
        platform: order.connection.platform,
        status: order.status,
        financialStatus: order.financialStatus,
        fulfillmentStatus: order.fulfillmentStatus,
        currency: order.currency,
        grossSales: order.grossSales.toFixed(4),
        totalCollected: order.totalCollected.toFixed(4),
        itemCount: order.itemCount,
        processedAt: order.processedAt.toISOString(),
        dispatch: mapDispatch(order.dispatch),
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getOrder(userId: string, orderId: string) {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: {
        connection: { select: { platform: true } },
        dispatch: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return {
      id: order.id,
      externalOrderId: order.externalOrderId,
      orderName: order.orderName,
      platform: order.connection.platform,
      status: order.status,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      currency: order.currency,
      grossSales: order.grossSales.toFixed(4),
      totalCollected: order.totalCollected.toFixed(4),
      itemCount: order.itemCount,
      processedAt: order.processedAt.toISOString(),
      dispatch: mapDispatch(order.dispatch),
    };
  }

  async getOrderProducts(
    userId: string,
    orderId: string,
  ): Promise<EcommerceOrderProductsDto> {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: { connection: { select: { platform: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const sourceOrder = await ((): Promise<
      Omit<
        EcommerceOrderProductsDto,
        'orderId' | 'itemCount' | 'productLineCount'
      >
    > => {
      switch (order.connection.platform) {
        case EcommercePlatform.SHOPIFY:
          return this.shopifyFulfillmentAdapter.fetchOrderProducts(
            userId,
            order.externalOrderId,
          );
        case EcommercePlatform.YOUCAN:
          return this.youCanFulfillmentAdapter.fetchOrderProducts(
            userId,
            order.externalOrderId,
          );
        case EcommercePlatform.LIGHTFUNNELS:
          return this.lightfunnelsFulfillmentAdapter.fetchOrderProducts(
            userId,
            order.externalOrderId,
          );
        default:
          throw new BadRequestException(
            'Platform not supported for order products',
          );
      }
    })();

    return {
      orderId: order.id,
      ...sourceOrder,
      itemCount: sourceOrder.products.reduce(
        (total, product) => total + product.quantity,
        0,
      ),
      productLineCount: sourceOrder.products.length,
    };
  }

  async getFulfillmentPreview(
    userId: string,
    orderId: string,
  ): Promise<EcommerceFulfillmentPreviewDto> {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: { connection: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    switch (order.connection.platform) {
      case EcommercePlatform.SHOPIFY:
        return this.shopifyFulfillmentAdapter.fetchFulfillmentPreview(
          userId,
          order.externalOrderId,
        );
      case EcommercePlatform.YOUCAN:
        return this.youCanFulfillmentAdapter.fetchFulfillmentPreview(
          userId,
          order.externalOrderId,
        );
      case EcommercePlatform.LIGHTFUNNELS:
        return this.lightfunnelsFulfillmentAdapter.fetchFulfillmentPreview(
          userId,
          order.externalOrderId,
        );
      default:
        throw new BadRequestException('Platform not supported for fulfillment');
    }
  }

  async dispatchOrder(
    userId: string,
    orderId: string,
    payload: EcommerceDispatchDto,
  ): Promise<EcommerceDispatchResponseDto> {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: { connection: true, dispatch: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.dispatch) {
      if (order.dispatch.status === 'DISPATCHED') {
        throw new BadRequestException('Order is already dispatched');
      }
      if (order.dispatch.status === 'PENDING') {
        throw new BadRequestException('Order dispatch is currently pending');
      }
    }

    const preview = await this.getFulfillmentPreview(userId, orderId);
    assertDispatchable(preview, payload.provider, payload.options);
    const merchantTracking = `ORD-${order.id.slice(0, 8).toUpperCase()}`;

    try {
      if (order.dispatch?.status === 'FAILED') {
        const claimed = await this.prisma.ecommerceOrderDispatch.updateMany({
          where: { id: order.dispatch.id, status: 'FAILED' },
          data: {
            provider: payload.provider,
            merchantTracking,
            providerTracking: null,
            status: 'PENDING',
            errorMessage: null,
          },
        });
        if (claimed.count !== 1) {
          throw new ConflictException(
            'Order dispatch is already being retried',
          );
        }
      } else {
        await this.prisma.ecommerceOrderDispatch.create({
          data: {
            orderId: order.id,
            provider: payload.provider,
            merchantTracking,
            status: 'PENDING',
          },
        });
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Order dispatch is already in progress');
      }
      throw error;
    }

    try {
      const codAmount = Number(
        (
          await this.currencyService.convertAmount(
            preview.codAmount,
            preview.currency,
            'MAD',
          )
        ).toFixed(2),
      );
      const providerResponse = await this.createProviderShipment(
        userId,
        payload.provider,
        payload.options,
        preview,
        merchantTracking,
        codAmount,
      );
      const providerTracking = extractProviderTracking(providerResponse);
      if (!providerTracking) {
        throw new BadGatewayException(
          `${payload.provider} accepted the request but did not return a tracking number`,
        );
      }
      const dispatch = await this.prisma.ecommerceOrderDispatch.update({
        where: { orderId: order.id },
        data: {
          status: 'DISPATCHED',
          providerTracking,
          errorMessage: null,
        },
      });
      return {
        trackingNumber: providerTracking,
        status: dispatch.status,
        provider: payload.provider,
        merchantTracking,
      };
    } catch (error) {
      await this.prisma.ecommerceOrderDispatch.updateMany({
        where: { orderId: order.id, status: 'PENDING' },
        data: { status: 'FAILED', errorMessage: safeDispatchError(error) },
      });
      throw error;
    }
  }

  private createProviderShipment(
    userId: string,
    provider: EcommerceDispatchDto['provider'],
    options: Record<string, unknown>,
    preview: EcommerceFulfillmentPreviewDto,
    merchantTracking: string,
    codAmount: number,
  ): Promise<unknown> {
    const contents = preview.lineItems
      .map((item) => `${item.title} x${item.quantity}`)
      .join(', ');
    const allowOpen = booleanOption(options, 'allowOpen', false);

    switch (provider) {
      case ShippingProvider.SENDIT:
        return this.shippingService.createSenditDelivery(userId, {
          pickup_district_id: integerOption(options, 'pickupDistrictId'),
          district_id: integerOption(options, 'destinationDistrictId'),
          name: preview.recipientName!,
          amount: codAmount,
          address: preview.address!,
          phone: preview.recipientPhone!,
          comment: preview.notes ?? undefined,
          reference: merchantTracking,
          allow_open: allowOpen ? 1 : 0,
          allow_try: booleanOption(options, 'allowTry', false) ? 1 : 0,
          products_from_stock: 0,
          products: contents || preview.orderReference,
        });
      case ShippingProvider.QUICKLIVRAISON:
        return this.shippingService.createQuickLivraisonDelivery(userId, {
          district_id: integerOption(options, 'destinationDistrictId'),
          name: preview.recipientName!,
          amount: codAmount,
          phone: preview.recipientPhone!,
          address: preview.address!,
          code: merchantTracking,
          note: preview.notes ?? undefined,
          open: allowOpen,
          try: booleanOption(options, 'allowTry', false),
          echange: false,
          prd_name: contents || preview.orderReference,
          qte_prd: Math.max(
            1,
            preview.lineItems.reduce((sum, item) => sum + item.quantity, 0),
          ),
        });
      case ShippingProvider.FORCELOG:
        return this.shippingService.addForceLogParcel(userId, {
          ORDER_NUM: merchantTracking.slice(0, 20),
          RECEIVE: preview.recipientName!.slice(0, 50),
          PHONE: preview.recipientPhone!.slice(0, 14),
          CITY: stringOption(options, 'destinationCity', preview.city!).slice(
            0,
            50,
          ),
          ADDRESS: preview.address!.slice(0, 100),
          HOW: preview.notes?.slice(0, 100),
          PRODUCT_NATURE: (contents || preview.orderReference).slice(0, 100),
          COD: codAmount,
          CAN_OPEN: allowOpen,
          FRAGILE: booleanOption(options, 'fragile', false),
        });
      case ShippingProvider.OZONEEXPRESS:
        return this.shippingService.addOzoneExpressParcel(userId, {
          trackingNumber: merchantTracking,
          receiver: preview.recipientName!,
          phone: preview.recipientPhone!,
          city: stringOption(options, 'destinationCity', preview.city!),
          address: preview.address!,
          price: codAmount,
          stock: 0,
          note: preview.notes ?? undefined,
          nature: contents || preview.orderReference,
          open: allowOpen ? 1 : 2,
          fragile: booleanOption(options, 'fragile', false) ? 1 : 0,
          replace: 0,
        });
      default:
        throw new BadRequestException('Unsupported shipping provider');
    }
  }

  async getRevenueSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<RevenueSummaryDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(query);
    const dateFilter = buildDateFilter(range);

    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        connection."platform"::text AS "platform",
        orders."currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(orders."grossSales"), 0) AS "grossSales",
        COALESCE(SUM(orders."discounts"), 0) AS "discounts",
        COALESCE(SUM(orders."refunds"), 0) AS "refunds",
        COALESCE(SUM(orders."netSales"), 0) AS "netSales",
        COALESCE(SUM(orders."shipping"), 0) AS "shipping",
        COALESCE(SUM(orders."tax"), 0) AS "tax",
        COALESCE(SUM(orders."totalCollected"), 0) AS "totalCollected"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      WHERE connection."storeId" = ${store.id}
        AND connection."includeInRevenue" = true
        AND orders."financialStatus" IN ${INCLUDED_PAYMENT_STATUSES}
        ${dateFilter}
      GROUP BY connection."platform", orders."currency"
      ORDER BY connection."platform", orders."currency"
    `);

    // Convert all amounts to the store's base currency
    for (const row of rows) {
      if (row.currency !== store.baseCurrency) {
        for (const key of amountKeys) {
          row[key] = await this.currencyService.convertAmount(
            row[key],
            row.currency,
            store.baseCurrency,
          );
        }
        row.currency = store.baseCurrency;
      }
    }

    const byPlatform = rows.map(toPlatformTotal);
    const totalsByCurrency = combineByCurrency(rows);
    return {
      period: range,
      totalsByCurrency,
      byPlatform,
      dataFreshAsOf: await this.getDataFreshness(store.id),
    };
  }

  async getRevenueTimeseries(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<RevenueTimeseriesDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(query, true);
    const dateFilter = buildDateFilter(range);

    const rows = await this.prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
      SELECT
        (orders."processedAt" AT TIME ZONE ${range.timezone})::date AS "date",
        orders."currency",
        COUNT(*)::int AS "orderCount",
        COALESCE(SUM(orders."grossSales"), 0) AS "grossSales",
        COALESCE(SUM(orders."discounts"), 0) AS "discounts",
        COALESCE(SUM(orders."refunds"), 0) AS "refunds",
        COALESCE(SUM(orders."netSales"), 0) AS "netSales",
        COALESCE(SUM(orders."shipping"), 0) AS "shipping",
        COALESCE(SUM(orders."tax"), 0) AS "tax",
        COALESCE(SUM(orders."totalCollected"), 0) AS "totalCollected"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      WHERE connection."storeId" = ${store.id}
        AND connection."includeInRevenue" = true
        AND orders."financialStatus" IN ${INCLUDED_PAYMENT_STATUSES}
        ${dateFilter}
      GROUP BY "date", orders."currency"
      ORDER BY "date", orders."currency"
    `);

    // Convert all amounts to the store's base currency
    for (const row of rows) {
      if (row.currency !== store.baseCurrency) {
        for (const key of amountKeys) {
          row[key] = await this.currencyService.convertAmount(
            row[key],
            row.currency,
            store.baseCurrency,
          );
        }
        row.currency = store.baseCurrency;
      }
    }

    return {
      period: range,
      data: rows.map((row) => ({
        date: formatSqlDate(row.date),
        currency: row.currency,
        orderCount: Number(row.orderCount),
        ...toAmounts(row),
      })),
    };
  }

  private async requireStore(
    userId: string,
  ): Promise<{ id: string; baseCurrency: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true, baseCurrency: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }

  private async getDataFreshness(storeId: string): Promise<string | null> {
    const connections = await this.prisma.ecommerceConnection.findMany({
      where: { storeId, includeInRevenue: true },
      select: { lastSyncedAt: true },
    });
    if (
      connections.length === 0 ||
      connections.some((connection) => connection.lastSyncedAt === null)
    ) {
      return null;
    }
    const oldest = connections.reduce(
      (current, connection) =>
        connection.lastSyncedAt! < current ? connection.lastSyncedAt! : current,
      connections[0].lastSyncedAt!,
    );
    return oldest.toISOString();
  }
}

function validateRange(
  query: RevenueRangeQueryDto,
  defaultToLast30Days = false,
): { from: string | null; to: string | null; timezone: string } {
  const timezone = query.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }

  let from = query.from ?? null;
  let to = query.to ?? null;
  if (defaultToLast30Days && !from && !to) {
    to = dateInTimezone(new Date(), timezone);
    from = addUtcDays(to, -29);
  }
  if (from) {
    assertCalendarDate(from, 'from');
  }
  if (to) {
    assertCalendarDate(to, 'to');
  }
  if (from && to && from > to) {
    throw new BadRequestException('from must be on or before to');
  }
  if (defaultToLast30Days && from && to) {
    const days =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days > MAX_TIMESERIES_DAYS) {
      throw new BadRequestException(
        `timeseries range cannot exceed ${MAX_TIMESERIES_DAYS} days`,
      );
    }
  }
  return { from, to, timezone };
}

function defaultHomeRange(query: RevenueRangeQueryDto): RevenueRangeQueryDto {
  if (query.from || query.to) {
    return query;
  }
  const timezone = query.timezone || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new BadRequestException('timezone must be a valid IANA timezone');
  }
  const to = dateInTimezone(new Date(), timezone);
  return {
    timezone,
    from: `${to.slice(0, 7)}-01`,
    to,
  };
}

function emptyHomeOrderMetrics(): HomeOrderMetricsRow {
  return {
    total: 0,
    inPeriod: 0,
    open: 0,
    unfulfilled: 0,
    readyToDispatch: 0,
    dispatched: 0,
    cancelled: 0,
    refunded: 0,
    dispatchTotal: 0,
    dispatchPending: 0,
    dispatchFailed: 0,
  };
}

function buildDateFilter(range: {
  from: string | null;
  to: string | null;
  timezone: string;
}): Prisma.Sql {
  const from = range.from
    ? Prisma.sql`AND orders."processedAt" >= (${range.from}::date AT TIME ZONE ${range.timezone})`
    : Prisma.empty;
  const to = range.to
    ? Prisma.sql`AND orders."processedAt" < ((${range.to}::date + INTERVAL '1 day') AT TIME ZONE ${range.timezone})`
    : Prisma.empty;
  return Prisma.sql`${from} ${to}`;
}

function toPlatformTotal(row: AggregateRow): RevenuePlatformTotalDto {
  return {
    platform: row.platform!,
    currency: row.currency,
    orderCount: Number(row.orderCount),
    ...toAmounts(row),
  };
}

function combineByCurrency(rows: AggregateRow[]): RevenueCurrencyTotalDto[] {
  const combined = new Map<
    string,
    {
      orderCount: number;
      amounts: Record<keyof RevenueAmountsDto, Prisma.Decimal>;
    }
  >();

  for (const row of rows) {
    const current = combined.get(row.currency) ?? {
      orderCount: 0,
      amounts: zeroAmounts(),
    };
    current.orderCount += Number(row.orderCount);
    for (const key of amountKeys) {
      current.amounts[key] = current.amounts[key].plus(row[key]);
    }
    combined.set(row.currency, current);
  }

  return [...combined.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => ({
      currency,
      orderCount: total.orderCount,
      ...decimalAmounts(total.amounts),
    }));
}

const amountKeys: (keyof RevenueAmountsDto)[] = [
  'grossSales',
  'discounts',
  'refunds',
  'netSales',
  'shipping',
  'tax',
  'totalCollected',
];

function toAmounts(row: AggregateRow): RevenueAmountsDto {
  return {
    grossSales: row.grossSales.toFixed(4),
    discounts: row.discounts.toFixed(4),
    refunds: row.refunds.toFixed(4),
    netSales: row.netSales.toFixed(4),
    shipping: row.shipping.toFixed(4),
    tax: row.tax.toFixed(4),
    totalCollected: row.totalCollected.toFixed(4),
  };
}

function zeroAmounts(): Record<keyof RevenueAmountsDto, Prisma.Decimal> {
  return Object.fromEntries(
    amountKeys.map((key) => [key, new Prisma.Decimal(0)]),
  ) as Record<keyof RevenueAmountsDto, Prisma.Decimal>;
}

function decimalAmounts(
  amounts: Record<keyof RevenueAmountsDto, Prisma.Decimal>,
): RevenueAmountsDto {
  return Object.fromEntries(
    amountKeys.map((key) => [key, amounts[key].toFixed(4)]),
  ) as unknown as RevenueAmountsDto;
}

function assertCalendarDate(value: string, field: string): void {
  const date = new Date(`${value}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException(`${field} must be a valid calendar date`);
  }
}

function dateInTimezone(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatSqlDate(value: Date | string | undefined): string {
  if (!value) {
    throw new Error('Revenue query returned an invalid date');
  }
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function mapDispatch(
  dispatch: {
    provider: string;
    merchantTracking: string;
    providerTracking: string | null;
    status: string;
    errorMessage: string | null;
    updatedAt: Date;
  } | null,
) {
  return dispatch
    ? {
        provider: dispatch.provider,
        merchantTracking: dispatch.merchantTracking,
        providerTracking: dispatch.providerTracking,
        status: dispatch.status,
        errorMessage: dispatch.errorMessage,
        updatedAt: dispatch.updatedAt.toISOString(),
      }
    : null;
}

function assertDispatchable(
  preview: EcommerceFulfillmentPreviewDto,
  provider: EcommerceDispatchDto['provider'],
  options: Record<string, unknown>,
): void {
  const missing = [
    ['recipient name', preview.recipientName],
    ['recipient phone', preview.recipientPhone],
    ['shipping address', preview.address],
  ].filter(([, value]) => typeof value !== 'string' || !value.trim());
  if (
    (provider === ShippingProvider.FORCELOG ||
      provider === ShippingProvider.OZONEEXPRESS) &&
    !preview.city &&
    !options?.destinationCity
  ) {
    missing.push(['destination city', preview.city]);
  }
  if (missing.length > 0) {
    throw new BadRequestException(
      `Source order is missing ${missing.map(([label]) => label).join(', ')}`,
    );
  }
  if (preview.status === 'CANCELLED') {
    throw new BadRequestException('Cancelled orders cannot be dispatched');
  }
  if (preview.lineItems.length === 0) {
    throw new BadRequestException('Order has no unfulfilled items to dispatch');
  }
}

function integerOption(options: Record<string, unknown>, key: string): number {
  const value = Number(options?.[key]);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new BadRequestException(`${key} must be a positive integer`);
  }
  return value;
}

function booleanOption(
  options: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = options?.[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${key} must be a boolean`);
  }
  return value;
}

function stringOption(
  options: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  const value = options?.[key] ?? fallback;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }
  return value.trim();
}

function extractProviderTracking(value: unknown, depth = 0): string | null {
  if (depth > 5 || !value) {
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractProviderTracking(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const preferredKeys = [
    'trackingnumber',
    'trackingcode',
    'parcelcode',
    'code',
  ];
  for (const preferred of preferredKeys) {
    for (const [key, candidate] of Object.entries(record)) {
      if (key.toLowerCase().replace(/[^a-z0-9]/g, '') !== preferred) continue;
      if (
        (typeof candidate === 'string' || typeof candidate === 'number') &&
        String(candidate).trim()
      ) {
        return String(candidate).trim();
      }
    }
  }
  for (const candidate of Object.values(record)) {
    const found = extractProviderTracking(candidate, depth + 1);
    if (found) return found;
  }
  return null;
}

function safeDispatchError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Dispatch failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 500);
}
