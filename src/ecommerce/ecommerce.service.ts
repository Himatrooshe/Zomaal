import {
  findManualOrderRetry,
  manualOrderRequestHash,
  MANUAL_REQUEST_EVENT_ID,
} from './manual-order-retry';
import {
  OrderConditionService,
  type ConditionInput,
  conditionSnapshot,
  publicConditionEntries,
} from './order-condition.service';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DuplicateOrderDecision, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreAccessService } from '../access/store-access.service';
import { ShopifyFulfillmentAdapter } from './shopify-fulfillment.adapter';
import { YouCanFulfillmentAdapter } from './youcan-fulfillment.adapter';
import { LightfunnelsFulfillmentAdapter } from './lightfunnels-fulfillment.adapter';
import { CurrencyService } from '../currency/currency.service';
import { AdsSpendService } from '../ads/ads-spend.service';
import { toUnconvertedDto } from '../ads/dto/ad-spend.dto';
import { CustomerRiskService } from '../customers/customer-risk.service';
import { EcommerceOrderQueryDto } from './dto/ecommerce-order-query.dto';
import { orderWhere } from './order-filter.util';
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
import { CodStatus } from './cod-status.util';
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
import { OrderStockService } from './order-stock.service';
import { ProductCondition } from './constants/product-condition';
import {
  deriveCurrentStatus,
  deriveTerminalOutcome,
} from './order-status.util';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';

// Q2.1: an order counts as revenue once delivered. The financial ledger
// records delivery from the courier (or the platform timeline for plugin
// shipping) and reverses it when the parcel comes back.
const DELIVERED_ORDER_FILTER = Prisma.sql`
  COALESCE((SELECT SUM(CASE WHEN outcome."type" IN ('REVENUE_RECOGNIZED','REVENUE_REINSTATED') THEN 1 WHEN outcome."type"='REVENUE_REVERSED' THEN -1 ELSE 0 END)
    FROM "EcommerceOrderFinancialEvent" outcome WHERE outcome."orderId"=orders."id"),0)>0
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

// Q2.3: lost orders are cancelled orders plus parcels the courier reports as
// cancelled, refused or returned at any stage of the return.
const LOST_SHIPMENT_STATUSES = Prisma.sql`(
  'CANCELLED'::"ShippingShipmentStatus",
  'REFUSED'::"ShippingShipmentStatus",
  'RETURN_PENDING'::"ShippingShipmentStatus",
  'RETURN_IN_TRANSIT'::"ShippingShipmentStatus",
  'RETURNED_TO_WAREHOUSE'::"ShippingShipmentStatus",
  'RETURN_INSPECTION'::"ShippingShipmentStatus",
  'RETURNED_TO_STOCK'::"ShippingShipmentStatus",
  'RETURNED_TO_SELLER'::"ShippingShipmentStatus"
)`;

// One dispatch has at most one linked shipment across these four courier
// integrations. Ameex is linked through verified, store-owned timeline events.
const SHIPMENT_STATUS_CTE = Prisma.sql`
  WITH ameex_status AS (
    SELECT DISTINCT ON (events."orderId") events."orderId", am."normalizedStatus"
    FROM "EcommerceOrderEvent" events
    INNER JOIN "AmeexShipment" am ON am."id"=events."metadata"->>'shipmentId'
    INNER JOIN "EcommerceOrder" o ON o."id"=events."orderId"
    INNER JOIN "EcommerceConnection" c ON c."id"=o."connectionId"
    INNER JOIN "Store" st ON st."id"=c."storeId" AND st."userId"=am."userId"
    WHERE events."metadata"->>'carrier'='AMEEX'
      AND NOT EXISTS (SELECT 1 FROM "EcommerceOrderDispatch" d WHERE d."orderId"=o."id")
    ORDER BY events."orderId",am."providerUpdatedAt" DESC NULLS LAST,am."updatedAt" DESC
  ), shipment_status AS (
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
    UNION ALL SELECT "orderId","normalizedStatus" FROM ameex_status
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
  lostCount: number | bigint;
  lostValue: Prisma.Decimal;
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
  lost: OrderStatusBucket;
  dataUpdatedAt: string | null;
}

const ORDER_STATUS_BUCKET_KEYS = [
  'confirmed',
  'delivered',
  'inDelivery',
  'refused',
  'cancelled',
  'lost',
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

const RETURNS_BUCKET_KEYS = [
  'received',
  'pending',
  'damaged',
  'missing',
] as const;

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
  private readonly logger = new Logger(EcommerceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly shopifyFulfillmentAdapter: ShopifyFulfillmentAdapter,
    private readonly youCanFulfillmentAdapter: YouCanFulfillmentAdapter,
    private readonly lightfunnelsFulfillmentAdapter: LightfunnelsFulfillmentAdapter,
    private readonly currencyService: CurrencyService,
    private readonly shippingService: ShippingService,
    private readonly orderStock: OrderStockService,
    private readonly financialService: EcommerceOrderFinancialService,
    private readonly customerRisk: CustomerRiskService,
    private readonly storeAccess: StoreAccessService,
    private readonly adsSpend: AdsSpendService,
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
      adSpend,
      recordedExpenseRows,
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
        this.prisma.ameexConnection.findUnique({ where: { userId } }),
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
      this.adsSpend.getTotals(store, range),
      // Purchases and shipping stay out of profit: the order ledger already
      // carries product cost and shipping, so subtracting them again would
      // count them twice.
      this.prisma.$queryRaw<
        { total: Prisma.Decimal; operating: Prisma.Decimal }[]
      >(Prisma.sql`
          SELECT
            COALESCE(SUM(expense."amount"), 0) AS "total",
            COALESCE(SUM(expense."amount") FILTER (
              WHERE category."group" IN ('SALARY'::"ExpenseGroup", 'OTHER'::"ExpenseGroup")
            ), 0) AS "operating"
          FROM "Expense" expense
          INNER JOIN "ExpenseCategory" category
            ON category."id" = expense."categoryId"
          WHERE expense."storeId" = ${store.id}
            ${buildSpentAtFilter(range)}
        `),
    ]);

    let orderProfit = new Prisma.Decimal(0);
    const unconvertedProfitCurrencies: string[] = [];
    for (const row of profitRows) {
      const converted = await this.toBaseOrSkip(
        row.netProfit,
        row.currency,
        store.baseCurrency,
        'Home profit',
      );
      if (converted) orderProfit = orderProfit.plus(converted);
      else unconvertedProfitCurrencies.push(row.currency);
    }
    const recordedExpenses = new Prisma.Decimal(
      recordedExpenseRows[0]?.total ?? 0,
    );
    const operatingExpenses = new Prisma.Decimal(
      recordedExpenseRows[0]?.operating ?? 0,
    );
    const expensesTotal = recordedExpenses.plus(adSpend.spend);
    const netProfit = orderProfit.minus(adSpend.spend).minus(operatingExpenses);
    const lostOrders = {
      orders: orderStatusBuckets.lost.count,
      value: orderStatusBuckets.lost.value.toFixed(4),
    };

    const row = orderRows[0] ?? emptyHomeOrderMetrics();
    const activeConnections = connectionsResult.data.filter(
      // Manual orders have no remote catalog or provider metrics to synchronize.
      (connection) =>
        connection.status === 'ACTIVE' &&
        connection.platform !== EcommercePlatform.MANUAL,
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
      profit: {
        value: netProfit.toFixed(4),
        orderProfit: orderProfit.toFixed(4),
        adSpend: adSpend.spend.toFixed(4),
        operatingExpenses: operatingExpenses.toFixed(4),
        unconvertedCurrencies: unconvertedProfitCurrencies.sort(),
      },
      lostOrders,
      ads: {
        spend: adSpend.spend.toFixed(2),
        results: adSpend.results,
        costPerResult: adSpend.costPerResult?.toFixed(2) ?? null,
        unconverted: toUnconvertedDto(adSpend.unconverted),
        dataUpdatedAt: adSpend.dataUpdatedAt?.toISOString() ?? null,
      },
      expenses: {
        total: expensesTotal.toFixed(2),
        avgPerOrder:
          Number(row.inPeriod) > 0
            ? expensesTotal.dividedBy(Number(row.inPeriod)).toFixed(2)
            : null,
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
    const where = orderWhere(store.id, query);

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

    const retryId = await findManualOrderRetry(this.prisma, store.id, dto);
    if (retryId) return this.getOrder(userId, retryId);

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

    // Resolved before the transaction, same reasoning as the sync/webhook
    // paths: CustomerRiskService's upsert is self-contained, and this lets
    // the order create include customerId directly. Every execution that
    // reaches here is a genuinely new order — the idempotent-retry path
    // above already returned early via getOrder().
    const customer = await this.customerRisk.upsertCustomer({
      storeId: store.id,
      phone: dto.customerPhone,
      name: dto.customerName,
      address: dto.shippingAddress,
      city: dto.shippingCity,
    });

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
            customerId: customer?.id ?? null,
            events: dto.idempotencyKey
              ? {
                  create: {
                    providerEventId: MANUAL_REQUEST_EVENT_ID,
                    source: 'SYSTEM',
                    type: 'ORDER_CREATED',
                    title: 'Manual order created',
                    occurredAt: now,
                    metadata: {
                      requestFingerprint: manualOrderRequestHash(dto),
                    },
                  },
                }
              : undefined,
            lines: { createMany: { data: lines } },
          },
        });
      });

      if (customer) {
        await this.customerRisk
          .recordNewOrder({
            storeId: store.id,
            customerId: customer.id,
            isBlacklisted: customer.isBlacklisted,
            orderId,
            occurredAt: now,
          })
          .catch(() => undefined); // never fail order creation over this
      }
    } catch (error) {
      // Two concurrent requests with the same idempotencyKey can both pass
      // the earlier existence check before either commits — the loser hits
      // this unique-constraint conflict instead of creating a duplicate.
      if (
        dto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existingId = await findManualOrderRetry(
          this.prisma,
          store.id,
          dto,
        );
        if (existingId) return this.getOrder(userId, existingId);
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
          include: { warehouseVariant: { include: SCANNED_VARIANT_INCLUDE } },
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
      include: {
        connection: true,
        dispatch: true,
        duplicateReview: { select: { decision: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    if (order.duplicateReview?.decision === DuplicateOrderDecision.CANCELLED) {
      throw new ConflictException(
        'This order was cancelled as a duplicate and cannot be shipped',
      );
    }

    if (order.dispatch) {
      if (order.dispatch.status === 'DISPATCHED') {
        throw new BadRequestException('Order is already dispatched');
      }
      if (order.dispatch.status === 'CANCELLED') {
        throw new BadRequestException(
          'This shipment was cancelled; create a replacement order to dispatch again',
        );
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
            codStatus: codAmount > 0 ? CodStatus.PENDING : null,
          },
        }),
      ]);
      // The courier already accepted the parcel; a stock hiccup must not
      // flip the dispatch to FAILED.
      try {
        await this.orderStock.reserveOrder(order.id);
      } catch (error) {
        this.logger.error(
          `Stock reservation failed for order ${order.id}: ${safeDispatchError(error)}`,
        );
      }
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
        !payload.trackingNumber.trim()
      )
        throw new BadRequestException(
          'Scanned QR payload is missing trackingNumber',
        );
      trackingNumber = payload.trackingNumber.trim();
    }
    if (!trackingNumber)
      throw new BadRequestException('Tracking number must not be blank');
    const store = await this.requireStore(userId);
    const owner = await this.prisma.store.findUnique({
      where: { id: store.id },
      select: { userId: true },
    });
    const [dispatches, events, ameex] = await Promise.all([
      this.prisma.ecommerceOrderDispatch.findMany({
        where: {
          providerTracking: trackingNumber,
          order: { connection: { storeId: store.id } },
        },
        take: 2,
        include: {
          order: {
            include: {
              lines: {
                include: {
                  warehouseVariant: { include: SCANNED_VARIANT_INCLUDE },
                },
              },
            },
          },
          senditShipment: { select: { normalizedStatus: true } },
          quickLivraisonShipment: { select: { normalizedStatus: true } },
          forceLogShipment: { select: { normalizedStatus: true } },
          ozoneExpressShipment: { select: { normalizedStatus: true } },
        },
      }),
      this.prisma.ecommerceOrderEvent.findMany({
        distinct: ['orderId'],
        take: 2,
        where: {
          order: { connection: { storeId: store.id } },
          metadata: { path: ['number'], equals: trackingNumber },
        },
        select: {
          metadata: true,
          order: {
            select: {
              id: true,
              orderName: true,
              events: { select: { type: true, occurredAt: true } },
              lines: {
                include: {
                  warehouseVariant: { include: SCANNED_VARIANT_INCLUDE },
                },
              },
            },
          },
        },
      }),
      owner
        ? this.prisma.ameexShipment.findFirst({
            where: { providerCode: trackingNumber, userId: owner.userId },
          })
        : Promise.resolve(null),
    ]);
    const ameexCandidates = ameex?.reference
      ? await this.prisma.ecommerceOrder.findMany({
          where: {
            connection: { store: { userId: owner!.userId } },
            OR: [{ id: ameex.reference }, { orderName: ameex.reference }],
          },
          take: 2,
          include: {
            connection: { select: { storeId: true } },
            lines: {
              include: {
                warehouseVariant: { include: SCANNED_VARIANT_INCLUDE },
              },
            },
          },
        })
      : [];
    if (ameexCandidates.length > 1)
      throw new ConflictException(
        'Shipment reference matches multiple stores/orders; select an order explicitly',
      );
    const ameexOrders = ameexCandidates.filter(
      (order) => order.connection.storeId === store.id,
    );
    const orderIds = new Set([
      ...dispatches.map((d) => d.order.id),
      ...events.map((e) => e.order.id),
      ...ameexOrders.map((o) => o.id),
    ]);
    if (orderIds.size > 1)
      throw new ConflictException(
        'Tracking number matches multiple orders; select an order explicitly',
      );
    if (dispatches[0]) {
      const d = dispatches[0],
        shipment =
          d.senditShipment ??
          d.quickLivraisonShipment ??
          d.forceLogShipment ??
          d.ozoneExpressShipment;
      return {
        orderId: d.order.id,
        orderName: d.order.orderName,
        source: 'ZOMAAL_COURIER' as const,
        provider: d.provider,
        trackingNumber,
        dispatchStatus: d.status,
        status: shipment?.normalizedStatus ?? null,
        products: mapScannedLines(d.order.lines),
      };
    }
    if (ameex && ameexOrders[0]) {
      const order = ameexOrders[0];
      return {
        orderId: order.id,
        orderName: order.orderName,
        source: 'ZOMAAL_COURIER' as const,
        provider: 'AMEEX',
        trackingNumber,
        dispatchStatus: null,
        status: ameex.normalizedStatus,
        products: mapScannedLines(order.lines),
      };
    }
    if (events[0]) {
      const e = events[0],
        metadata = e.metadata as { carrier?: unknown } | null;
      return {
        orderId: e.order.id,
        orderName: e.order.orderName,
        source: 'PLATFORM_TRACKING' as const,
        provider:
          typeof metadata?.carrier === 'string'
            ? metadata.carrier
            : 'Unknown carrier',
        trackingNumber,
        dispatchStatus: null,
        status:
          deriveTerminalOutcome(e.order.events) ??
          deriveCurrentStatus(e.order.events),
        products: mapScannedLines(e.order.lines),
      };
    }
    throw new NotFoundException('No shipment found for this code');
  }

  /**
   * Builds the JSON payload for the shipment QR sticker Zomaal prints and
   * attaches to the parcel (separate from the carrier's own label). Only
   * available once the order has a tracking number — i.e. after dispatch.
   */
  /**
   * The write side of the warehouse scan workflow: after resolveScannedCode()
   * identifies the order/products, this records what condition each product
   * came back in and applies the stock effect via OrderStockService, which
   * depends on whether the unit had already been deducted at delivery.
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

    const matchingLines = order.lines.filter(
      (candidate) =>
        candidate.warehouseVariant?.productCode === input.productCode,
    );
    if (matchingLines.length > 1)
      throw new ConflictException(
        'Product occurs on multiple order lines; verify by orderLineId',
      );
    const line = matchingLines[0];
    if (!line) {
      throw new NotFoundException(
        `No line on this order matches product code ${input.productCode}`,
      );
    }

    const result = await this.applyProductCondition(store, order, line, input);
    return { ...result, productCode: input.productCode };
  }

  /**
   * Same recording + inventory-movement + damage-loss logic as
   * recordProductCondition above, keyed by orderLineId instead of
   * productCode — used by the Returns module (ReturnRequestService) so it
   * can record a condition for ANY order line, including ones with no
   * matched warehouse product/productCode (recordProductCondition can't
   * reach those). Single source of truth: recordProductCondition and this
   * both delegate to applyProductCondition below — never duplicated.
   */
  async verifyProductConditions(
    storeId: string,
    orderId: string,
    inputs: ConditionInput[],
    context?: { returnRequestId: string; reason?: string },
  ) {
    return new OrderConditionService(
      this.prisma,
      this.financialService,
      this.currencyService,
    ).record(storeId, orderId, inputs, context);
  }

  async recordProductConditionByLineId(
    userId: string,
    orderId: string,
    orderLineId: string,
    input: {
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
    const line = order.lines.find((candidate) => candidate.id === orderLineId);
    if (!line) {
      throw new NotFoundException('Order line not found on this order');
    }
    return this.applyProductCondition(store, order, line, input);
  }

  private async applyProductCondition(
    store: { id: string },
    order: { id: string; orderName: string | null; currency: string },
    line: { id: string },
    input: { condition: ProductCondition; damageCost?: number; notes?: string },
  ) {
    const updated = await this.verifyProductConditions(store.id, order.id, [
      {
        orderLineId: line.id,
        condition: input.condition,
        ...(input.damageCost === undefined
          ? {}
          : { damageCost: input.damageCost }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      },
    ]);
    const recorded = updated.lines.find(
      (candidate) => candidate.id === line.id,
    )!;
    return {
      orderId: order.id,
      orderLineId: line.id,
      condition: recorded.condition ?? input.condition,
      damageCost: recorded.damageCost?.toFixed(2) ?? null,
      notes: recorded.conditionNotes,
      recordedAt:
        recorded.conditionRecordedAt?.toISOString() ?? new Date().toISOString(),
      inventoryUpdated: updated.inventoryUpdates[line.id] ?? false,
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
                        quantity: true,
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
                .filter((component) => !!component.componentVariant.productCode)
                .map((component) => ({
                  productCode: component.componentVariant.productCode!,
                  quantity: component.quantity * line.quantity,
                })),
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
            quantity: only.quantity,
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
        AND ${DELIVERED_ORDER_FILTER}
        ${dateFilter}
      GROUP BY connection."platform", orders."currency"
      ORDER BY connection."platform", orders."currency"
    `);

    await this.convertRowsToBase(rows, store.baseCurrency);

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
        AND ${DELIVERED_ORDER_FILTER}
        ${dateFilter}
      GROUP BY "date", orders."currency"
      ORDER BY "date", orders."currency"
    `);

    await this.convertRowsToBase(rows, store.baseCurrency);

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
   * "confirmed" is every order not cancelled; the other buckets read the
   * dispatched courier shipment's normalizedStatus (order.status = CANCELLED
   * also counts toward "cancelled" and "lost" for orders never dispatched).
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
        COUNT(*) FILTER (
          WHERE orders."status" = 'CANCELLED'
            OR ss."normalizedStatus" IN ${LOST_SHIPMENT_STATUSES}
        )::int AS "lostCount",
        COALESCE(SUM(orders."netSales") FILTER (
          WHERE orders."status" = 'CANCELLED'
            OR ss."normalizedStatus" IN ${LOST_SHIPMENT_STATUSES}
        ), 0) AS "lostValue",
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
      lost: { count: 0, value: new Prisma.Decimal(0) },
      dataUpdatedAt: null,
    };
    let latestUpdatedAt: Date | null = null;

    for (const row of rows) {
      for (const key of ORDER_STATUS_BUCKET_KEYS) {
        const countField = `${key}Count` as keyof OrderStatusBucketRow;
        const valueField = `${key}Value` as keyof OrderStatusBucketRow;
        buckets[key].count += Number(row[countField]);
        const converted = await this.toBaseOrSkip(
          row[valueField] as Prisma.Decimal,
          row.currency,
          store.baseCurrency,
          'Order status buckets',
        );
        if (converted) buckets[key].value = buckets[key].value.plus(converted);
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
      SELECT lines."currency",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."receivedItems",0) ELSE CASE WHEN lines."condition" IN ('GOOD','RETURNED') THEN lines."quantity" ELSE 0 END END),0)::int AS "receivedItems",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."receivedValue",0) ELSE CASE WHEN lines."condition" IN ('GOOD','RETURNED') THEN lines."totalPrice" ELSE 0 END END),0) AS "receivedValue",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN GREATEST(COALESCE((lines."conditionAllocations"->>'expectedQuantity')::int,0)-COALESCE(alloc."allocatedItems",0),0) ELSE CASE WHEN lines."condition" IS NULL AND ss."normalizedStatus" IN ${RETURN_IN_PROGRESS_STATUSES} THEN lines."quantity" ELSE 0 END END),0)::int AS "pendingItems",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN GREATEST(lines."totalPrice"-COALESCE(alloc."allocatedValue",0),0) ELSE CASE WHEN lines."condition" IS NULL AND ss."normalizedStatus" IN ${RETURN_IN_PROGRESS_STATUSES} THEN lines."totalPrice" ELSE 0 END END),0) AS "pendingValue",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."damagedItems",0) ELSE CASE WHEN lines."condition"='DAMAGED' THEN lines."quantity" ELSE 0 END END),0)::int AS "damagedItems",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."damagedValue",0) ELSE CASE WHEN lines."condition"='DAMAGED' THEN COALESCE(lines."damageCost",wv."costPrice"*lines."quantity",0) ELSE 0 END END),0) AS "damagedValue",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."missingItems",0) ELSE CASE WHEN lines."condition" IN ('MISSING','LOST') THEN lines."quantity" ELSE 0 END END),0)::int AS "missingItems",
        COALESCE(SUM(CASE WHEN lines."conditionAllocations" IS NOT NULL THEN COALESCE(alloc."missingValue",0) ELSE CASE WHEN lines."condition" IN ('MISSING','LOST') THEN COALESCE(wv."costPrice"*lines."quantity",0) ELSE 0 END END),0) AS "missingValue",
        MAX(lines."updatedAt") AS "latestUpdatedAt"
      FROM "EcommerceOrderLine" lines
      INNER JOIN "EcommerceOrder" orders ON orders."id" = lines."orderId"
      INNER JOIN "EcommerceConnection" connection
        ON connection."id" = orders."connectionId"
      LEFT JOIN shipment_status ss ON ss."orderId" = orders."id"
      LEFT JOIN "WarehouseVariant" wv ON wv."id"=lines."warehouseVariantId"
      LEFT JOIN LATERAL (
        SELECT
          SUM((e->>'physicalQuantity')::int) FILTER (WHERE e->>'condition' IN ('GOOD','RETURNED')) AS "receivedItems",
          SUM((e->>'saleValue')::numeric) FILTER (WHERE e->>'condition' IN ('GOOD','RETURNED')) AS "receivedValue",
          SUM((e->>'physicalQuantity')::int) AS "allocatedItems",
          SUM((e->>'saleValue')::numeric) AS "allocatedValue",
          SUM((e->>'physicalQuantity')::int) FILTER (WHERE e->>'condition'='DAMAGED') AS "damagedItems",
          SUM(COALESCE((e->>'damageCost')::numeric,(e->>'unitCost')::numeric*(e->>'quantity')::int)) FILTER (WHERE e->>'condition'='DAMAGED') AS "damagedValue",
          SUM((e->>'physicalQuantity')::int) FILTER (WHERE e->>'condition' IN ('LOST','MISSING')) AS "missingItems",
          SUM((e->>'unitCost')::numeric*(e->>'quantity')::int) FILTER (WHERE e->>'condition' IN ('LOST','MISSING')) AS "missingValue"
        FROM jsonb_array_elements(COALESCE(lines."conditionAllocations"->'entries','[]'::jsonb)) e
      ) alloc ON true

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
        const converted = await this.toBaseOrSkip(
          row[valueField] as Prisma.Decimal,
          row.currency,
          store.baseCurrency,
          'Returns buckets',
        );
        if (converted) buckets[key].value = buckets[key].value.plus(converted);
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

  /** Rows with no available rate keep their own currency rather than a guess. */
  private async convertRowsToBase(
    rows: AggregateRow[],
    baseCurrency: string,
  ): Promise<void> {
    for (const row of rows) {
      if (row.currency === baseCurrency) continue;
      const converted: Partial<
        Record<(typeof amountKeys)[number], Prisma.Decimal>
      > = {};
      for (const key of amountKeys) {
        const value = await this.currencyService.convertOrNull(
          row[key],
          row.currency,
          baseCurrency,
        );
        if (!value) break;
        converted[key] = value;
      }
      if (Object.keys(converted).length !== amountKeys.length) continue;
      Object.assign(row, converted);
      row.currency = baseCurrency;
    }
  }

  /** Converts to the base currency, or returns null and logs when no rate exists. */
  private async toBaseOrSkip(
    value: Prisma.Decimal,
    currency: string,
    baseCurrency: string,
    context: string,
  ): Promise<Prisma.Decimal | null> {
    if (currency === baseCurrency) return new Prisma.Decimal(value);
    const converted = await this.currencyService.convertOrNull(
      value,
      currency,
      baseCurrency,
    );
    if (!converted) {
      this.logger.warn(
        `${context}: left out ${currency} amounts, no exchange rate to ${baseCurrency}`,
      );
    }
    return converted;
  }

  private async requireStore(
    userId: string,
  ): Promise<{ id: string; baseCurrency: string }> {
    const store = await this.storeAccess.requireStore(userId);
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

function buildSpentAtFilter(range: {
  from: string | null;
  to: string | null;
  timezone: string;
}): Prisma.Sql {
  const from = range.from
    ? Prisma.sql`AND expense."spentAt" >= (${range.from}::date AT TIME ZONE ${range.timezone})`
    : Prisma.empty;
  const to = range.to
    ? Prisma.sql`AND expense."spentAt" < ((${range.to}::date + INTERVAL '1 day') AT TIME ZONE ${range.timezone})`
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

const SCANNED_VARIANT_INCLUDE = {
  product: {
    include: {
      bundleComponents: {
        include: { componentVariant: { include: { product: true } } },
      },
    },
  },
} satisfies Prisma.WarehouseVariantInclude;

function mapScannedLines(
  lines: {
    id: string;
    quantity: number;
    condition: string | null;
    damageCost: Prisma.Decimal | null;
    conditionAllocations?: unknown;
    conditionRevision?: number;
    warehouseVariant: {
      id?: string;
      productCode: string | null;
      product: {
        name: string;
        kind?: string;
        bundleComponents?: {
          quantity: number;
          componentVariant: {
            id: string;
            productCode: string | null;
            title: string;
            product: { name: string };
          };
        }[];
      };
    } | null;
  }[],
) {
  return lines
    .filter((line) => line.warehouseVariant?.productCode)
    .map((line) => ({
      orderLineId: line.id,
      productCode: line.warehouseVariant!.productCode!,
      productName: line.warehouseVariant!.product.name,
      quantity: line.quantity,
      condition: line.condition,
      damageCost: line.damageCost?.toFixed(2) ?? null,
      kind: line.warehouseVariant!.product.kind ?? 'STANDARD',
      allocations: publicConditionEntries(line.conditionAllocations),
      conditionComplete:
        conditionSnapshot(line.conditionAllocations)?.completed ?? null,
      conditionRevision: line.conditionRevision ?? 0,
      components: (line.warehouseVariant!.product.bundleComponents ?? []).map(
        (component) => ({
          componentVariantId: component.componentVariant.id,
          productCode: component.componentVariant.productCode,
          productName: component.componentVariant.product.name,
          variantTitle: component.componentVariant.title,
          quantityPerPack: component.quantity,
          quantity: component.quantity * line.quantity,
        }),
      ),
    }));
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
