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
import {
  EcommercePlatform,
  WarehouseProductKind,
  EcommerceOrderStatus,
  EcommercePaymentStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CreateManualOrderDto } from './dto/create-manual-order.dto';
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
import type { OrderStatusSummaryResponseDto } from './dto/order-status-summary.dto';
import type { ReturnsSummaryResponseDto } from './dto/returns-summary.dto';
import { ShippingService } from '../shipping/shipping.service';
import { InventoryService } from '../warehouse/inventory.service';
import { InventoryBucket, InventoryMovementType } from '@prisma/client';
import { ProductCondition } from './constants/product-condition';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';

const INCLUDED_PAYMENT_STATUSES = Prisma.sql`
  (
    'PARTIALLY_PAID'::"EcommercePaymentStatus",
    'PAID'::"EcommercePaymentStatus",
    'PARTIALLY_REFUNDED'::"EcommercePaymentStatus",
    'REFUNDED'::"EcommercePaymentStatus"
  )
`;
const MAX_TIMESERIES_DAYS = 366;

// Courier statuses grouped as "still moving toward delivery" for the order
// status buckets. DELIVERED/REFUSED/CANCELLED are broken out separately.
const IN_DELIVERY_STATUSES = Prisma.sql`(
  'PENDING'::"ShippingShipmentStatus",
  'CONFIRMED'::"ShippingShipmentStatus",
  'PICKUP_PENDING'::"ShippingShipmentStatus",
  'PICKED_UP'::"ShippingShipmentStatus",
  'AT_WAREHOUSE'::"ShippingShipmentStatus",
  'IN_TRANSIT'::"ShippingShipmentStatus",
  'OUT_FOR_DELIVERY'::"ShippingShipmentStatus",
  'POSTPONED'::"ShippingShipmentStatus",
  'UNREACHABLE'::"ShippingShipmentStatus"
)`;

// Courier statuses meaning "a return is in progress" for the returns-pending
// bucket. Once the item is scanned, its EcommerceOrderLine.condition is set
// and it moves into received/damaged/missing instead.
const RETURN_IN_PROGRESS_STATUSES = Prisma.sql`(
  'RETURN_PENDING'::"ShippingShipmentStatus",
  'RETURN_IN_TRANSIT'::"ShippingShipmentStatus",
  'RETURNED_TO_WAREHOUSE'::"ShippingShipmentStatus",
  'RETURN_INSPECTION'::"ShippingShipmentStatus"
)`;

// One dispatch has at most one linked shipment across these four courier
// integrations (Ameex is not wired to EcommerceOrderDispatch, so it is
// intentionally excluded — see shipping-dashboard.service.ts).
const SHIPMENT_STATUS_CTE = Prisma.sql`
  WITH shipment_status AS (
    SELECT
      dispatch."orderId" AS "orderId",
      COALESCE(
        sendit."normalizedStatus",
        quick."normalizedStatus",
        forcelog."normalizedStatus",
        ozone."normalizedStatus"
      ) AS "normalizedStatus"
    FROM "EcommerceOrderDispatch" dispatch
    LEFT JOIN "SenditShipment" sendit ON sendit."dispatchId" = dispatch."id"
    LEFT JOIN "QuickLivraisonShipment" quick ON quick."dispatchId" = dispatch."id"
    LEFT JOIN "ForceLogShipment" forcelog ON forcelog."dispatchId" = dispatch."id"
    LEFT JOIN "OzoneExpressShipment" ozone ON ozone."dispatchId" = dispatch."id"
  )
`;

interface OrderStatusBucketRow {
  currency: string;
  confirmedCount: number | bigint;
  confirmedValue: Prisma.Decimal;
  deliveredCount: number | bigint;
  deliveredValue: Prisma.Decimal;
  inDeliveryCount: number | bigint;
  inDeliveryValue: Prisma.Decimal;
  refusedCount: number | bigint;
  refusedValue: Prisma.Decimal;
  cancelledCount: number | bigint;
  cancelledValue: Prisma.Decimal;
  latestUpdatedAt: Date | null;
}

interface OrderStatusBucket {
  count: number;
  value: Prisma.Decimal;
}

interface OrderStatusBuckets {
  confirmed: OrderStatusBucket;
  delivered: OrderStatusBucket;
  inDelivery: OrderStatusBucket;
  refused: OrderStatusBucket;
  cancelled: OrderStatusBucket;
  dataUpdatedAt: string | null;
}

const ORDER_STATUS_BUCKET_KEYS = [
  'confirmed',
  'delivered',
  'inDelivery',
  'refused',
  'cancelled',
] as const;

interface ReturnsBucketRow {
  currency: string;
  receivedItems: number | bigint;
  receivedValue: Prisma.Decimal;
  pendingItems: number | bigint;
  pendingValue: Prisma.Decimal;
  damagedItems: number | bigint;
  damagedValue: Prisma.Decimal;
  missingItems: number | bigint;
  missingValue: Prisma.Decimal;
  latestUpdatedAt: Date | null;
}

interface ReturnsBucket {
  items: number;
  value: Prisma.Decimal;
}

interface ReturnsBuckets {
  received: ReturnsBucket;
  pending: ReturnsBucket;
  damaged: ReturnsBucket;
  missing: ReturnsBucket;
  dataUpdatedAt: string | null;
}

const RETURNS_BUCKET_KEYS = ['received', 'pending', 'damaged', 'missing'] as const;

interface ProfitRow {
  currency: string;
  netProfit: Prisma.Decimal;
}

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
    private readonly inventoryService: InventoryService,
    private readonly financialService: EcommerceOrderFinancialService,
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
      orderStatusBuckets,
      profitRows,
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
      this.getOrderStatusBuckets(store, range),
      this.prisma.$queryRaw<ProfitRow[]>(Prisma.sql`
          SELECT
            events."currency",
            COALESCE(SUM(events."netProfitImpact"), 0) AS "netProfit"
          FROM "EcommerceOrderFinancialEvent" events
          INNER JOIN "EcommerceOrder" orders ON orders."id" = events."orderId"
          INNER JOIN "EcommerceConnection" connection
            ON connection."id" = orders."connectionId"
          WHERE connection."storeId" = ${store.id}
            ${dateFilter}
          GROUP BY events."currency"
        `),
    ]);

    let profitValue = new Prisma.Decimal(0);
    for (const row of profitRows) {
      profitValue = profitValue.plus(
        row.currency === store.baseCurrency
          ? new Prisma.Decimal(row.netProfit)
          : await this.currencyService.convertAmount(
              row.netProfit,
              row.currency,
              store.baseCurrency,
            ),
      );
    }
    const lostOrders = {
      orders:
        orderStatusBuckets.refused.count + orderStatusBuckets.cancelled.count,
      value: orderStatusBuckets.refused.value
        .plus(orderStatusBuckets.cancelled.value)
        .toFixed(4),
    };

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
      profit: { value: profitValue.toFixed(4) },
      lostOrders,
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
        grossSales: order.grossSales.toFixed(2),
        discounts: order.discounts.toFixed(2),
        shipping: order.shipping.toFixed(2),
        refunds: order.refunds.toFixed(2),
        netSales: order.netSales.toFixed(2),
        totalCollected: order.totalCollected.toFixed(2),
        codAmount: order.codAmount?.toFixed(2) ?? null,
        codStatus: order.codStatus ?? null,
        itemCount: order.itemCount,
        processedAt: order.processedAt.toISOString(),
        cancelledAt: order.cancelledAt?.toISOString() ?? null,
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
      grossSales: order.grossSales.toFixed(2),
      discounts: order.discounts.toFixed(2),
      shipping: order.shipping.toFixed(2),
      refunds: order.refunds.toFixed(2),
      netSales: order.netSales.toFixed(2),
      totalCollected: order.totalCollected.toFixed(2),
      codAmount: order.codAmount?.toFixed(2) ?? null,
      codStatus: order.codStatus ?? null,
      itemCount: order.itemCount,
      processedAt: order.processedAt.toISOString(),
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      dispatch: mapDispatch(order.dispatch),
    };
  }

  /**
   * Creates an order that never touched Shopify/YouCan/Lightfunnels —
   * WhatsApp, phone, in-person. Products are resolved by Product Tracking
   * Code (must already exist in the warehouse catalog), and customer info is
   * captured directly since there's no platform to fetch it from later.
   * Once created, this order goes through the exact same dispatch/timeline/
   * financial-event machinery as any synced order — the source stops
   * mattering after this point.
   */
  async createManualOrder(userId: string, dto: CreateManualOrderDto) {
    const store = await this.requireStore(userId);
    const currency = (dto.currency ?? store.baseCurrency).toUpperCase();

    // Retry-safe when the client supplies a key: reuses the existing
    // (connectionId, externalOrderId) uniqueness rather than a separate
    // idempotency column, since MANUAL externalOrderId is already
    // synthetic (see below).
    if (dto.idempotencyKey) {
      const existing = await this.prisma.ecommerceOrder.findFirst({
        where: {
          externalOrderId: `MANUAL-${dto.idempotencyKey}`,
          connection: { storeId: store.id, platform: EcommercePlatform.MANUAL },
        },
        select: { id: true },
      });
      if (existing) {
        return this.getOrder(userId, existing.id);
      }
    }

    const productCodes = dto.items.map((item) => item.productCode);
    const variants = await this.prisma.warehouseVariant.findMany({
      where: { storeId: store.id, productCode: { in: productCodes } },
      select: {
        id: true,
        productCode: true,
        price: true,
        title: true,
        product: { select: { name: true } },
      },
    });
    const variantByCode = new Map(
      variants.map((variant) => [variant.productCode as string, variant]),
    );
    const missing = [...new Set(productCodes)].filter(
      (code) => !variantByCode.has(code),
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Unknown product code(s): ${missing.join(', ')}`,
      );
    }

    const lines = dto.items.map((item, index) => {
      const variant = variantByCode.get(item.productCode)!;
      const unitPrice = new Prisma.Decimal(item.unitPrice ?? variant.price);
      const totalPrice = unitPrice.times(item.quantity);
      return {
        externalLineId: `manual-${index}`,
        warehouseVariantId: variant.id,
        sku: item.productCode,
        name: variant.product.name,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        currency,
      };
    });

    const grossSales = lines.reduce(
      (sum, line) => sum.plus(line.totalPrice),
      new Prisma.Decimal(0),
    );
    const shipping = new Prisma.Decimal(dto.shippingCost ?? 0);
    const netSales = grossSales;
    const totalCollected = netSales.plus(shipping);
    const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);
    const now = new Date();
    const orderId = randomUUID();
    const orderName = `#${orderId.slice(0, 8).toUpperCase()}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        const connection = await tx.ecommerceConnection.upsert({
          where: {
            storeId_platform: {
              storeId: store.id,
              platform: EcommercePlatform.MANUAL,
            },
          },
          create: {
            storeId: store.id,
            platform: EcommercePlatform.MANUAL,
            externalAccountId: store.id,
            displayName: 'Manual orders',
            includeInRevenue: true,
          },
          update: {},
        });

        await tx.ecommerceOrder.create({
          data: {
            id: orderId,
            connectionId: connection.id,
            externalOrderId: dto.idempotencyKey
              ? `MANUAL-${dto.idempotencyKey}`
              : `MANUAL-${orderId}`,
            orderName,
            status: EcommerceOrderStatus.OPEN,
            financialStatus: EcommercePaymentStatus.PENDING,
            fulfillmentStatus: null,
            currency,
            itemCount,
            grossSales,
            discounts: new Prisma.Decimal(0),
            refunds: new Prisma.Decimal(0),
            netSales,
            shipping,
            tax: new Prisma.Decimal(0),
            totalCollected,
            shippingCity: dto.shippingCity ?? null,
            manualCustomerName: dto.customerName,
            manualCustomerPhone: dto.customerPhone,
            manualShippingAddress: dto.shippingAddress,
            manualShippingCountry: dto.shippingCountry ?? null,
            manualNotes: dto.notes ?? null,
            providerCreatedAt: now,
            processedAt: now,
            providerUpdatedAt: now,
            lines: { createMany: { data: lines } },
          },
        });
      });
    } catch (error) {
      // Two concurrent requests with the same idempotencyKey can both pass
      // the earlier existence check before either commits — the loser hits
      // this unique-constraint conflict instead of creating a duplicate.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.ecommerceOrder.findFirst({
          where: {
            externalOrderId: `MANUAL-${dto.idempotencyKey}`,
            connection: {
              storeId: store.id,
              platform: EcommercePlatform.MANUAL,
            },
          },
          select: { id: true },
        });
        if (existing) {
          return this.getOrder(userId, existing.id);
        }
      }
      throw error;
    }

    return this.getOrder(userId, orderId);
  }

  async getOrderProducts(
    userId: string,
    orderId: string,
  ): Promise<EcommerceOrderProductsDto> {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: {
        connection: { select: { platform: true } },
        lines: {
          include: { warehouseVariant: { include: { product: true } } },
        },
      },
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
        case EcommercePlatform.MANUAL:
          // Products ARE the stored order lines — no live platform to fetch.
          return Promise.resolve({
            platform: EcommercePlatform.MANUAL,
            externalOrderId: order.externalOrderId,
            orderReference: order.orderName ?? order.externalOrderId,
            currency: order.currency,
            complete: true,
            products: order.lines.map((line) => ({
              lineItemId: line.id,
              productId: line.warehouseVariant?.product.id ?? null,
              variantId: line.warehouseVariantId,
              title: line.name,
              variantTitle: line.warehouseVariant?.title ?? null,
              sku: line.sku,
              quantity: line.quantity,
              unitPrice: line.unitPrice.toFixed(4),
              totalPrice: line.totalPrice.toFixed(4),
              currency: line.currency,
              imageUrl: null,
            })),
          });
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
      include: {
        connection: true,
        lines: {
          include: { warehouseVariant: { select: { productCode: true } } },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const preview = await ((): Promise<EcommerceFulfillmentPreviewDto> => {
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
        case EcommercePlatform.MANUAL:
          // No external platform to fetch from — everything needed was
          // captured at order creation time (see createManualOrder()).
          return Promise.resolve({
            platform: EcommercePlatform.MANUAL,
            externalOrderId: order.externalOrderId,
            orderReference: order.orderName ?? order.externalOrderId,
            recipientName: order.manualCustomerName,
            recipientPhone: order.manualCustomerPhone,
            address: order.manualShippingAddress,
            city: order.shippingCity,
            country: order.manualShippingCountry,
            currency: order.currency,
            codAmount: order.totalCollected.toFixed(2),
            lineItems: order.lines.map((line) => ({
              title: line.name,
              sku: line.sku ?? '',
              quantity: line.quantity,
            })),
            notes: order.manualNotes,
            status: order.status,
            financialStatus: order.financialStatus,
            fulfillmentStatus: order.fulfillmentStatus,
          });
        default:
          throw new BadRequestException(
            'Platform not supported for fulfillment',
          );
      }
    })();

    // Resolve each platform line item to its Product Tracking Code by matching
    // SKU against a linked warehouse variant, so dispatch can put the code —
    // not the full title — on the shipping ticket.
    const codeBySku = new Map(
      order.lines
        .filter(
          (line): line is typeof line & { sku: string } =>
            !!line.sku && !!line.warehouseVariant?.productCode,
        )
        .map((line) => [
          line.sku,
          line.warehouseVariant!.productCode as string,
        ]),
    );
    preview.lineItems = preview.lineItems.map((item) => ({
      ...item,
      productCode: item.sku ? (codeBySku.get(item.sku) ?? null) : null,
    }));

    return preview;
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
      const [dispatch] = await this.prisma.$transaction([
        this.prisma.ecommerceOrderDispatch.update({
          where: { orderId: order.id },
          data: {
            status: 'DISPATCHED',
            providerTracking,
            errorMessage: null,
          },
        }),
        this.prisma.ecommerceOrder.update({
          where: { id: order.id },
          data: {
            codAmount: codAmount,
            codStatus: 'PENDING',
          },
        }),
      ]);
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

  /**
   * Resolves whatever text a scanner just read — either a Zomaal shipment QR
   * (JSON payload, encoded by getShipmentQrPayload) or a raw courier tracking
   * number read straight off the carrier's own barcode — back to the order,
   * its products, and the LIVE dispatch status. Both inputs converge on the
   * same lookup key: trackingNumber. Status is always re-read from the
   * database here — never trust a status baked into a printed/scanned code,
   * it goes stale the moment it's printed.
   */
  async resolveScannedCode(userId: string, scannedText: string) {
    const trimmed = scannedText.trim();
    let trackingNumber = trimmed;
    if (trimmed.startsWith('{')) {
      let payload: { trackingNumber?: unknown };
      try {
        payload = JSON.parse(trimmed) as { trackingNumber?: unknown };
      } catch {
        throw new BadRequestException('Scanned QR payload is not valid JSON');
      }
      if (
        typeof payload.trackingNumber !== 'string' ||
        !payload.trackingNumber
      ) {
        throw new BadRequestException(
          'Scanned QR payload is missing trackingNumber',
        );
      }
      trackingNumber = payload.trackingNumber;
    }

    const store = await this.requireStore(userId);
    const dispatch = await this.prisma.ecommerceOrderDispatch.findFirst({
      where: {
        providerTracking: trackingNumber,
        order: { connection: { storeId: store.id } },
      },
      include: {
        order: {
          include: {
            lines: {
              include: { warehouseVariant: { include: { product: true } } },
            },
          },
        },
        // Dispatch.status only tells you whether we succeeded in HANDING
        // the parcel to the courier (PENDING/DISPATCHED/FAILED) — it never
        // changes again after that. The real "where is it now" status
        // (PICKED_UP/IN_TRANSIT/DELIVERED/...) lives on whichever of these
        // 4 courier-specific tables is linked.
        senditShipment: { select: { normalizedStatus: true } },
        quickLivraisonShipment: { select: { normalizedStatus: true } },
        forceLogShipment: { select: { normalizedStatus: true } },
        ozoneExpressShipment: { select: { normalizedStatus: true } },
      },
    });
    if (!dispatch) {
      throw new NotFoundException('No shipment found for this code');
    }

    const shipment =
      dispatch.senditShipment ??
      dispatch.quickLivraisonShipment ??
      dispatch.forceLogShipment ??
      dispatch.ozoneExpressShipment ??
      null;

    return {
      orderId: dispatch.order.id,
      orderName: dispatch.order.orderName,
      provider: dispatch.provider,
      // Guaranteed non-null: the where clause above only matches dispatches
      // whose providerTracking equals trackingNumber.
      trackingNumber: dispatch.providerTracking ?? trackingNumber,
      dispatchStatus: dispatch.status,
      // Null only if the courier hasn't sent us a status update yet (or we
      // haven't synced/received its webhook). Never derived from dispatch
      // status — that would silently show "PENDING" forever after delivery.
      status: shipment?.normalizedStatus ?? null,
      products: dispatch.order.lines
        .filter((line) => line.warehouseVariant?.productCode)
        .map((line) => ({
          productCode: line.warehouseVariant!.productCode as string,
          productName: line.warehouseVariant!.product.name,
          quantity: line.quantity,
          condition: line.condition,
          damageCost: line.damageCost?.toFixed(2) ?? null,
        })),
    };
  }

  /**
   * Builds the JSON payload for the shipment QR sticker Zomaal prints and
   * attaches to the parcel (separate from the carrier's own label). Only
   * available once the order has a tracking number — i.e. after dispatch.
   */
  /**
   * The write side of the warehouse scan workflow: after resolveScannedCode()
   * identifies the order/products, this records what condition each product
   * came back in and, for GOOD/RETURNED/DAMAGED, applies the matching
   * inventory movement in the same call. LOST/MISSING create no movement —
   * there is nothing physical to place in a bucket, only the record itself.
   */
  async recordProductCondition(
    userId: string,
    orderId: string,
    input: {
      productCode: string;
      condition: ProductCondition;
      damageCost?: number;
      notes?: string;
    },
  ) {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: {
        lines: {
          include: {
            warehouseVariant: { include: { inventoryItem: true } },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const line = order.lines.find(
      (candidate) =>
        candidate.warehouseVariant?.productCode === input.productCode,
    );
    if (!line) {
      throw new NotFoundException(
        `No line on this order matches product code ${input.productCode}`,
      );
    }

    const damageCost =
      input.condition === ProductCondition.DAMAGED &&
      input.damageCost !== undefined
        ? new Prisma.Decimal(input.damageCost)
        : null;
    const notes = input.notes?.trim() || null;
    const recordedAt = new Date();

    // Captured BEFORE the update below overwrites them — needed to detect
    // whether this call is a correction (condition or cost actually changed)
    // versus the first-ever recording or an exact repeat.
    const previousCondition = line.condition as ProductCondition | null;
    const previousDamageCost = line.damageCost;
    const conditionChanged =
      previousCondition !== null && previousCondition !== input.condition;
    const costChanged =
      previousDamageCost !== null &&
      damageCost !== null &&
      !previousDamageCost.equals(damageCost);

    await this.prisma.ecommerceOrderLine.update({
      where: { id: line.id },
      data: {
        condition: input.condition,
        damageCost,
        conditionNotes: notes,
        conditionRecordedAt: recordedAt,
      },
    });

    const inventoryItem = line.warehouseVariant?.inventoryItem;
    const previousMovement = conditionChanged
      ? movementForCondition(previousCondition)
      : null;
    const movement = movementForCondition(input.condition);
    let inventoryUpdated = false;
    if (inventoryItem) {
      if (conditionChanged && previousMovement) {
        // Correcting to a different condition — undo the earlier condition's
        // stock effect first, or the unit ends up double-counted across two
        // buckets (e.g. GOOD's +on-hand still standing after a DAMAGED
        // correction also adds +damaged for the same physical unit).
        await this.inventoryService.applyMovement(store.id, inventoryItem.id, {
          type: previousMovement.type,
          bucket: previousMovement.bucket,
          quantityDelta: -line.quantity,
          reason: `Correction: reversing previous condition ${previousCondition} (order ${order.orderName ?? order.id})`,
          referenceType: 'ORDER_RETURN_CORRECTION',
          referenceId: order.id,
          idempotencyKey: `return-reverse:${line.id}:${previousCondition}:${recordedAt.getTime()}`,
        });
      }
      if (movement) {
        await this.inventoryService.applyMovement(store.id, inventoryItem.id, {
          type: movement.type,
          bucket: movement.bucket,
          quantityDelta: line.quantity,
          reason: `Return condition: ${input.condition} (order ${order.orderName ?? order.id})`,
          referenceType: 'ORDER_RETURN',
          referenceId: order.id,
          // Re-recording the SAME condition twice reuses this stable key —
          // idempotent, no-op on repeat. A correction (condition changed)
          // gets a timestamp-suffixed key instead, since the stable key may
          // already be "spent" by an earlier condition that flip-flopped
          // back to this one.
          idempotencyKey: conditionChanged
            ? `return:${line.id}:${input.condition}:${recordedAt.getTime()}`
            : `return:${line.id}:${input.condition}`,
        });
        inventoryUpdated = true;
      }
    }

    if (damageCost) {
      await this.financialService.applyDamageLoss(
        order.id,
        line.id,
        order.currency,
        damageCost,
        conditionChanged || costChanged ? recordedAt.getTime() : undefined,
      );
    }

    return {
      orderId: order.id,
      productCode: input.productCode,
      condition: input.condition,
      damageCost: damageCost?.toFixed(2) ?? null,
      notes,
      recordedAt: recordedAt.toISOString(),
      inventoryUpdated,
    };
  }

  async getShipmentQrPayload(userId: string, orderId: string) {
    const store = await this.requireStore(userId);
    const order = await this.prisma.ecommerceOrder.findUnique({
      where: { id: orderId, connection: { storeId: store.id } },
      include: {
        dispatch: true,
        lines: {
          include: {
            warehouseVariant: {
              select: {
                productCode: true,
                product: {
                  select: {
                    kind: true,
                    bundleComponents: {
                      select: {
                        componentVariant: { select: { productCode: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (!order.dispatch?.providerTracking) {
      throw new BadRequestException(
        'Order has not been dispatched yet — no tracking number to encode',
      );
    }

    // A bundle/pack is ONE line whose product.kind is BUNDLE — its own variant's
    // productCode is the pack code, and its components list the physical items
    // inside. A plain multi-product order is a different shape: several
    // ordinary PRODUCT lines, not a pack.
    const items = order.lines
      .filter((line) => line.warehouseVariant?.productCode)
      .map((line) => {
        const variant = line.warehouseVariant!;
        return variant.product.kind === WarehouseProductKind.BUNDLE
          ? {
              type: 'PACK' as const,
              packCode: variant.productCode as string,
              quantity: line.quantity,
              items: variant.product.bundleComponents
                .map((component) => component.componentVariant.productCode)
                .filter((code): code is string => !!code),
            }
          : {
              type: 'PRODUCT' as const,
              productCode: variant.productCode as string,
              quantity: line.quantity,
            };
      });

    if (items.length === 0) {
      throw new BadRequestException(
        "None of this order's lines are linked to a warehouse product with a product code yet",
      );
    }

    const orderRef = order.orderName ?? order.dispatch.merchantTracking;
    const trackingNumber = order.dispatch.providerTracking;

    // Single line: emit the flat PRODUCT/PACK shape. Multiple lines: wrap them
    // in an ORDER envelope so every item's own code/quantity is still explicit.
    if (items.length === 1) {
      const only = items[0];
      return only.type === 'PACK'
        ? {
            type: 'PACK' as const,
            packCode: only.packCode,
            orderId: orderRef,
            trackingNumber,
            items: only.items,
          }
        : {
            type: 'PRODUCT' as const,
            productCode: only.productCode,
            orderId: orderRef,
            trackingNumber,
          };
    }
    return { type: 'ORDER' as const, orderId: orderRef, trackingNumber, items };
  }

  private createProviderShipment(
    userId: string,
    provider: EcommerceDispatchDto['provider'],
    options: Record<string, unknown>,
    preview: EcommerceFulfillmentPreviewDto,
    merchantTracking: string,
    codAmount: number,
  ): Promise<unknown> {
    // Product Tracking Code on the ticket instead of the full title, wherever
    // the line has been matched to a warehouse product; falls back to title
    // when it hasn't (e.g. product not yet created in Zomaal's catalog).
    const contents = preview.lineItems
      .map((item) => `${item.productCode ?? item.title} x${item.quantity}`)
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

  async getOrderStatusSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<OrderStatusSummaryResponseDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(defaultHomeRange(query));
    const buckets = await this.getOrderStatusBuckets(store, range);

    return {
      period: range,
      currency: store.baseCurrency,
      confirmed: toOrderStatusBucketDto(buckets.confirmed),
      delivered: toOrderStatusBucketDto(buckets.delivered),
      inDelivery: toOrderStatusBucketDto(buckets.inDelivery),
      refused: toOrderStatusBucketDto(buckets.refused),
      cancelled: toOrderStatusBucketDto(buckets.cancelled),
      dataUpdatedAt: buckets.dataUpdatedAt,
    };
  }

  async getReturnsSummary(
    userId: string,
    query: RevenueRangeQueryDto,
  ): Promise<ReturnsSummaryResponseDto> {
    const store = await this.requireStore(userId);
    const range = validateRange(defaultHomeRange(query));
    const buckets = await this.getReturnsBuckets(store, range);

    return {
      period: range,
      currency: store.baseCurrency,
      received: toReturnsBucketDto(buckets.received),
      pending: toReturnsBucketDto(buckets.pending),
      damaged: toReturnsBucketDto(buckets.damaged),
      missing: toReturnsBucketDto(buckets.missing),
      dataUpdatedAt: buckets.dataUpdatedAt,
    };
  }

  /**
   * Buckets orders in the period by their fulfillment/courier outcome.
   * Shared by GET /ecommerce/orders/status-summary and the Profit/Lost-Orders
   * rollups on GET /ecommerce/home so the two screens never disagree.
   * "confirmed" reuses the same paid/partially-paid/refunded definition as
   * revenue/summary; the other buckets read the dispatched courier
   * shipment's normalizedStatus (order.status = CANCELLED also counts toward
   * "cancelled" for orders never dispatched at all).
   */
  private async getOrderStatusBuckets(
    store: { id: string; baseCurrency: string },
    range: { from: string | null; to: string | null; timezone: string },
  ): Promise<OrderStatusBuckets> {
    const dateFilter = buildDateFilter(range);
    const rows = await this.prisma.$queryRaw<OrderStatusBucketRow[]>(Prisma.sql`
      ${SHIPMENT_STATUS_CTE}
      SELECT
        orders."currency",
        COUNT(*) FILTER (
          WHERE orders."status" <> 'CANCELLED'
        )::int AS "confirmedCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE orders."status" <> 'CANCELLED'
        ), 0) AS "confirmedValue",
        COUNT(*) FILTER (
          WHERE ss."normalizedStatus" = 'DELIVERED'::"ShippingShipmentStatus"
        )::int AS "deliveredCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE ss."normalizedStatus" = 'DELIVERED'::"ShippingShipmentStatus"
        ), 0) AS "deliveredValue",
        COUNT(*) FILTER (
          WHERE ss."normalizedStatus" IN ${IN_DELIVERY_STATUSES}
        )::int AS "inDeliveryCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE ss."normalizedStatus" IN ${IN_DELIVERY_STATUSES}
        ), 0) AS "inDeliveryValue",
        COUNT(*) FILTER (
          WHERE ss."normalizedStatus" = 'REFUSED'::"ShippingShipmentStatus"
        )::int AS "refusedCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE ss."normalizedStatus" = 'REFUSED'::"ShippingShipmentStatus"
        ), 0) AS "refusedValue",
        COUNT(*) FILTER (
          WHERE orders."status" = 'CANCELLED'
            OR ss."normalizedStatus" = 'CANCELLED'::"ShippingShipmentStatus"
        )::int AS "cancelledCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE orders."status" = 'CANCELLED'
            OR ss."normalizedStatus" = 'CANCELLED'::"ShippingShipmentStatus"
        ), 0) AS "cancelledValue",
        MAX(orders."updatedAt") AS "latestUpdatedAt"
      FROM "EcommerceOrder" orders
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      LEFT JOIN shipment_status ss ON ss."orderId" = orders."id"
      WHERE connection."storeId" = ${store.id}
        ${dateFilter}
      GROUP BY orders."currency"
    `);

    const buckets: OrderStatusBuckets = {
      confirmed: { count: 0, value: new Prisma.Decimal(0) },
      delivered: { count: 0, value: new Prisma.Decimal(0) },
      inDelivery: { count: 0, value: new Prisma.Decimal(0) },
      refused: { count: 0, value: new Prisma.Decimal(0) },
      cancelled: { count: 0, value: new Prisma.Decimal(0) },
      dataUpdatedAt: null,
    };
    let latestUpdatedAt: Date | null = null;

    for (const row of rows) {
      for (const key of ORDER_STATUS_BUCKET_KEYS) {
        const countField = `${key}Count` as keyof OrderStatusBucketRow;
        const valueField = `${key}Value` as keyof OrderStatusBucketRow;
        buckets[key].count += Number(row[countField]);
        const rawValue = row[valueField] as Prisma.Decimal;
        const converted =
          row.currency === store.baseCurrency
            ? new Prisma.Decimal(rawValue)
            : await this.currencyService.convertAmount(
                rawValue,
                row.currency,
                store.baseCurrency,
              );
        buckets[key].value = buckets[key].value.plus(converted);
      }
      if (
        row.latestUpdatedAt &&
        (!latestUpdatedAt || row.latestUpdatedAt > latestUpdatedAt)
      ) {
        latestUpdatedAt = row.latestUpdatedAt;
      }
    }

    buckets.dataUpdatedAt = latestUpdatedAt?.toISOString() ?? null;
    return buckets;
  }

  /**
   * Buckets returned order lines by outcome for the Returns screen. Period
   * filters by the parent order's processedAt (consistent with the other
   * dashboard endpoints), not by conditionRecordedAt — "pending" has no
   * condition recorded yet, so it has no other timestamp to filter on.
   */
  private async getReturnsBuckets(
    store: { id: string; baseCurrency: string },
    range: { from: string | null; to: string | null; timezone: string },
  ): Promise<ReturnsBuckets> {
    const dateFilter = buildDateFilter(range);
    const rows = await this.prisma.$queryRaw<ReturnsBucketRow[]>(Prisma.sql`
      ${SHIPMENT_STATUS_CTE}
      SELECT
        lines."currency",
        COALESCE(SUM(lines."quantity") FILTER (
          WHERE lines."condition" IN ('GOOD', 'RETURNED')
        ), 0)::int AS "receivedItems",
        COALESCE(SUM(lines."totalPrice") FILTER (
          WHERE lines."condition" IN ('GOOD', 'RETURNED')
        ), 0) AS "receivedValue",
        COALESCE(SUM(lines."quantity") FILTER (
          WHERE lines."condition" IS NULL
            AND ss."normalizedStatus" IN ${RETURN_IN_PROGRESS_STATUSES}
        ), 0)::int AS "pendingItems",
        COALESCE(SUM(lines."totalPrice") FILTER (
          WHERE lines."condition" IS NULL
            AND ss."normalizedStatus" IN ${RETURN_IN_PROGRESS_STATUSES}
        ), 0) AS "pendingValue",
        COALESCE(SUM(lines."quantity") FILTER (
          WHERE lines."condition" = 'DAMAGED'
        ), 0)::int AS "damagedItems",
        COALESCE(SUM(COALESCE(lines."damageCost", lines."totalPrice")) FILTER (
          WHERE lines."condition" = 'DAMAGED'
        ), 0) AS "damagedValue",
        COALESCE(SUM(lines."quantity") FILTER (
          WHERE lines."condition" IN ('MISSING', 'LOST')
        ), 0)::int AS "missingItems",
        COALESCE(SUM(lines."totalPrice") FILTER (
          WHERE lines."condition" IN ('MISSING', 'LOST')
        ), 0) AS "missingValue",
        MAX(lines."updatedAt") AS "latestUpdatedAt"
      FROM "EcommerceOrderLine" lines
      INNER JOIN "EcommerceOrder" orders ON orders."id" = lines."orderId"
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      LEFT JOIN shipment_status ss ON ss."orderId" = orders."id"
      WHERE connection."storeId" = ${store.id}
        ${dateFilter}
      GROUP BY lines."currency"
    `);

    const buckets: ReturnsBuckets = {
      received: { items: 0, value: new Prisma.Decimal(0) },
      pending: { items: 0, value: new Prisma.Decimal(0) },
      damaged: { items: 0, value: new Prisma.Decimal(0) },
      missing: { items: 0, value: new Prisma.Decimal(0) },
      dataUpdatedAt: null,
    };
    let latestUpdatedAt: Date | null = null;

    for (const row of rows) {
      for (const key of RETURNS_BUCKET_KEYS) {
        const itemsField = `${key}Items` as keyof ReturnsBucketRow;
        const valueField = `${key}Value` as keyof ReturnsBucketRow;
        buckets[key].items += Number(row[itemsField]);
        const rawValue = row[valueField] as Prisma.Decimal;
        const converted =
          row.currency === store.baseCurrency
            ? new Prisma.Decimal(rawValue)
            : await this.currencyService.convertAmount(
                rawValue,
                row.currency,
                store.baseCurrency,
              );
        buckets[key].value = buckets[key].value.plus(converted);
      }
      if (
        row.latestUpdatedAt &&
        (!latestUpdatedAt || row.latestUpdatedAt > latestUpdatedAt)
      ) {
        latestUpdatedAt = row.latestUpdatedAt;
      }
    }

    buckets.dataUpdatedAt = latestUpdatedAt?.toISOString() ?? null;
    return buckets;
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

function toOrderStatusBucketDto(bucket: OrderStatusBucket) {
  return { orders: bucket.count, value: bucket.value.toFixed(4) };
}

function toReturnsBucketDto(bucket: ReturnsBucket) {
  return { items: bucket.items, value: bucket.value.toFixed(4) };
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

function movementForCondition(
  condition: ProductCondition,
): { type: InventoryMovementType; bucket: InventoryBucket } | null {
  switch (condition) {
    case ProductCondition.GOOD:
    case ProductCondition.RETURNED:
      return {
        type: InventoryMovementType.RETURN_GOOD,
        bucket: InventoryBucket.ON_HAND,
      };
    case ProductCondition.DAMAGED:
      return {
        type: InventoryMovementType.RETURN_DAMAGED,
        bucket: InventoryBucket.DAMAGED,
      };
    case ProductCondition.LOST:
    case ProductCondition.MISSING:
      return null;
  }
}
