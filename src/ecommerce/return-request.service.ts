import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ReturnRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EcommerceService } from './ecommerce.service';
import { EcommerceOrderFinancialService } from './ecommerce-order-financial.service';
import { ProductCondition } from './constants/product-condition';
import type {
  DetectReturnDto,
  DetectedReturnResponseDto,
  ReturnListQueryDto,
  ReturnListResponseDto,
  VerifyReturnDto,
  VerifiedReturnResponseDto,
} from './dto/return-request.dto';

// A NEED_VERIFICATION return request older than this is presented as
// DELAYED on the Returns list. Not a stored status — computed at read
// time, so there is no background job needed to flip it, and it self-heals
// the moment it's verified.
const DELAYED_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

type OrderLineForLoss = {
  id: string;
  totalPrice: Prisma.Decimal;
  condition: string | null;
  damageCost: Prisma.Decimal | null;
};

@Injectable()
export class ReturnRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ecommerceService: EcommerceService,
    private readonly financialService: EcommerceOrderFinancialService,
  ) {}

  /**
   * Scan screen + Return Detected screen's data source. Resolution order:
   * 1. dto.orderId, if given directly (the client already resolved it via
   *    GET .../search and the user tapped a result).
   * 2. Otherwise, the same scan resolution EcommerceService.scan() uses —
   *    a Zomaal shipment QR or a raw courier tracking number, covering
   *    both ZOMAAL_COURIER and PLATFORM_TRACKING orders.
   * 3. Otherwise, an order ID/name match — the Scan screen's own "Or enter
   *    order ID manually" fallback.
   * Finds an existing open (NEED_VERIFICATION) ReturnRequest for the
   * matched order, or creates one covering every line on the order.
   */
  async detect(
    userId: string,
    dto: DetectReturnDto,
  ): Promise<DetectedReturnResponseDto> {
    const store = await this.requireStore(userId);
    const order = await this.resolveOrder(store.id, dto);

    let returnRequest = await this.prisma.returnRequest.findFirst({
      where: { orderId: order.id, status: ReturnRequestStatus.NEED_VERIFICATION },
      include: { lines: { include: { orderLine: true } } },
    });

    if (!returnRequest) {
      try {
        returnRequest = await this.prisma.returnRequest.create({
          data: {
            orderId: order.id,
            detectedVia: dto.orderId ? 'MANUAL' : 'SCAN',
            scannedValue: dto.value,
            lines: {
              create: order.lines.map((line) => ({
                orderLineId: line.id,
                quantity: line.quantity,
              })),
            },
          },
          include: { lines: { include: { orderLine: true } } },
        });
      } catch (error) {
        // Two concurrent detect() calls for the same order (double-tap on
        // the Scan screen, two staff scanning the same parcel) can both
        // pass the findFirst above seeing nothing yet — the partial unique
        // index on ReturnRequest(orderId) WHERE status='NEED_VERIFICATION'
        // (see prisma/migrations/*_open_unique_index) lets exactly one
        // create() win; the loser re-reads and returns the winner's row
        // instead of a 500.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          returnRequest = await this.prisma.returnRequest.findFirstOrThrow({
            where: { orderId: order.id, status: ReturnRequestStatus.NEED_VERIFICATION },
            include: { lines: { include: { orderLine: true } } },
          });
        } else {
          throw error;
        }
      }
    }

    const customer = await this.resolveCustomer(userId, order);
    const deliveryCost = await this.financialService.resolveEffectiveShippingCost(order.id);
    const lines = returnRequest.lines.map((rl) => rl.orderLine);

    return {
      returnRequestId: returnRequest.id,
      orderId: order.id,
      orderName: order.orderName,
      status: this.presentStatus(returnRequest),
      customerName: customer.name,
      customerPhone: customer.phone,
      address: customer.address,
      products: lines.map((line) => ({
        orderLineId: line.id,
        productCode: line.sku,
        name: line.name,
        quantity: line.quantity,
        totalPrice: line.totalPrice.toFixed(2),
        imageUrl: null,
        condition: line.condition,
      })),
      lossSummary: this.computeLoss(lines, deliveryCost),
    };
  }

  /**
   * Return Detected screen's Confirm/Save. Records each line's condition
   * via EcommerceService.recordProductConditionByLineId — the exact same
   * inventory-movement + damage-loss-financial-event logic as the existing
   * per-order condition endpoint, never duplicated here. Once every line on
   * the return request has a recorded condition, the request auto-advances
   * to PROCESSED.
   */
  async verify(
    userId: string,
    returnRequestId: string,
    dto: VerifyReturnDto,
  ): Promise<VerifiedReturnResponseDto> {
    const store = await this.requireStore(userId);
    const returnRequest = await this.prisma.returnRequest.findFirst({
      where: { id: returnRequestId, order: { connection: { storeId: store.id } } },
      include: { lines: true, order: { select: { id: true } } },
    });
    if (!returnRequest) {
      throw new NotFoundException('Return request not found');
    }

    const lineIds = new Set(returnRequest.lines.map((l) => l.orderLineId));
    for (const input of dto.lines) {
      if (!lineIds.has(input.orderLineId)) {
        throw new BadRequestException(
          `Order line ${input.orderLineId} is not part of this return request`,
        );
      }
      await this.ecommerceService.recordProductConditionByLineId(
        userId,
        returnRequest.orderId,
        input.orderLineId,
        {
          condition: input.condition as ProductCondition,
          damageCost: input.damageCost,
        },
      );
    }

    const updated = await this.prisma.returnRequest.update({
      where: { id: returnRequest.id },
      data: { reason: dto.reason ?? returnRequest.reason },
      include: { lines: { include: { orderLine: true } } },
    });

    const lines = updated.lines.map((rl) => rl.orderLine);
    const allVerified = lines.every((line) => line.condition !== null);
    if (allVerified && updated.status !== ReturnRequestStatus.PROCESSED) {
      await this.prisma.returnRequest.update({
        where: { id: updated.id },
        data: { status: ReturnRequestStatus.PROCESSED, verifiedAt: new Date() },
      });
    }

    const deliveryCost = await this.financialService.resolveEffectiveShippingCost(returnRequest.orderId);

    return {
      returnRequestId: updated.id,
      status: allVerified ? 'PROCESSED' : 'NEED_VERIFICATION',
      lossSummary: this.computeLoss(lines, deliveryCost),
    };
  }

  /**
   * Returns screen (list + summary cards). "DELAYED" is derived, not
   * stored — see DELAYED_AFTER_MS above. "totalOrderConfirm" is
   * interpreted as COD orders awaiting confirmation (financialStatus
   * PENDING with a codAmount), a different concept bundled onto the same
   * screen per the mockup — flagged on the DTO for the same reason.
   */
  async list(userId: string, query: ReturnListQueryDto): Promise<ReturnListResponseDto> {
    const store = await this.requireStore(userId);
    const delayedCutoff = new Date(Date.now() - DELAYED_AFTER_MS);

    const where: Prisma.ReturnRequestWhereInput = {
      order: { connection: { storeId: store.id } },
    };
    if (query.search) {
      where.order = {
        connection: { storeId: store.id },
        OR: [
          { externalOrderId: query.search },
          { orderName: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }
    if (query.status === 'NEED_VERIFICATION') {
      where.status = ReturnRequestStatus.NEED_VERIFICATION;
      where.createdAt = { gt: delayedCutoff };
    } else if (query.status === 'DELAYED') {
      where.status = ReturnRequestStatus.NEED_VERIFICATION;
      where.createdAt = { lte: delayedCutoff };
    } else if (query.status === 'PROCESSED') {
      where.status = ReturnRequestStatus.PROCESSED;
    }

    const page = query.page || 1;
    const limit = query.limit || 20;

    const [total, requests, summaryRows, confirmOrders] = await Promise.all([
      this.prisma.returnRequest.count({ where }),
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          order: { select: { id: true, orderName: true, manualCustomerName: true, manualCustomerPhone: true } },
          lines: { include: { orderLine: true } },
        },
      }),
      // DB-side aggregate for the two summary cards, not a full materialize-
      // every-return-ever-then-sum-in-JS pass — cost scales with what's
      // actually being summed, not with total return history size.
      this.prisma.$queryRaw<
        { totalCount: bigint; totalValue: Prisma.Decimal; pendingCount: bigint; pendingValue: Prisma.Decimal }[]
      >(Prisma.sql`
        SELECT
          COUNT(DISTINCT rr."id")::int AS "totalCount",
          COALESCE(SUM(ol."totalPrice"), 0) AS "totalValue",
          COUNT(DISTINCT rr."id") FILTER (WHERE rr."status" = 'NEED_VERIFICATION')::int AS "pendingCount",
          COALESCE(SUM(ol."totalPrice") FILTER (WHERE rr."status" = 'NEED_VERIFICATION'), 0) AS "pendingValue"
        FROM "ReturnRequest" rr
        INNER JOIN "EcommerceOrder" o ON o."id" = rr."orderId"
        INNER JOIN "EcommerceConnection" c ON c."id" = o."connectionId"
        LEFT JOIN "ReturnRequestLine" rrl ON rrl."returnRequestId" = rr."id"
        LEFT JOIN "EcommerceOrderLine" ol ON ol."id" = rrl."orderLineId"
        WHERE c."storeId" = ${store.id}
      `),
      this.prisma.ecommerceOrder.aggregate({
        where: {
          connection: { storeId: store.id },
          financialStatus: 'PENDING',
          codAmount: { not: null },
          status: { not: 'CANCELLED' },
        },
        _sum: { totalCollected: true },
        _count: true,
      }),
    ]);

    const summaryRow = summaryRows[0];

    return {
      summary: {
        totalReturns: {
          value: (summaryRow?.totalValue ?? new Prisma.Decimal(0)).toFixed(2),
          orders: Number(summaryRow?.totalCount ?? 0),
        },
        pendingVerification: {
          value: (summaryRow?.pendingValue ?? new Prisma.Decimal(0)).toFixed(2),
          orders: Number(summaryRow?.pendingCount ?? 0),
        },
        totalOrderConfirm: {
          value: (confirmOrders._sum.totalCollected ?? new Prisma.Decimal(0)).toFixed(2),
          orders: confirmOrders._count,
        },
      },
      data: requests.map((r) => {
        const lines = r.lines.map((rl) => rl.orderLine);
        const first = lines[0];
        return {
          returnRequestId: r.id,
          orderId: r.order.id,
          orderName: r.order.orderName,
          customerName: r.order.manualCustomerName,
          customerPhone: r.order.manualCustomerPhone,
          productSummary: first
            ? lines.length > 1
              ? `${first.name} +${lines.length - 1} more`
              : first.name
            : 'No products',
          status: this.presentStatus(r),
          value: lines.reduce((sum, l) => sum.plus(l.totalPrice), new Prisma.Decimal(0)).toFixed(2),
          createdAt: r.createdAt.toISOString(),
        };
      }),
      total,
      page,
      limit,
    };
  }

  /**
   * Manual Verification screen's search box. Order ID/name matches every
   * platform. Phone/name matches ONLY MANUAL orders — Shopify/YouCan/
   * Lightfunnels orders intentionally don't store customer PII at rest
   * (see EcommerceOrder's manualCustomerName/Phone comment in schema.prisma)
   * so there is nothing to search for those without a live per-candidate
   * platform call, which this endpoint deliberately does not do.
   */
  async search(userId: string, q: string) {
    const store = await this.requireStore(userId);
    const orders = await this.prisma.ecommerceOrder.findMany({
      where: {
        connection: { storeId: store.id },
        OR: [
          { externalOrderId: { contains: q, mode: 'insensitive' } },
          { orderName: { contains: q, mode: 'insensitive' } },
          { manualCustomerName: { contains: q, mode: 'insensitive' } },
          { manualCustomerPhone: { contains: q } },
        ],
      },
      take: 20,
      orderBy: { processedAt: 'desc' },
      select: {
        id: true,
        orderName: true,
        externalOrderId: true,
        manualCustomerName: true,
        manualCustomerPhone: true,
      },
    });
    return {
      data: orders.map((o) => ({
        orderId: o.id,
        orderName: o.orderName,
        externalOrderId: o.externalOrderId,
        customerName: o.manualCustomerName,
        customerPhone: o.manualCustomerPhone,
      })),
    };
  }

  private async resolveOrder(storeId: string, dto: DetectReturnDto) {
    if (dto.orderId) {
      const order = await this.prisma.ecommerceOrder.findFirst({
        where: { id: dto.orderId, connection: { storeId } },
        include: { lines: true },
      });
      if (!order) throw new NotFoundException('Order not found');
      return order;
    }

    // Try the same tracking-number resolution as GET /ecommerce/scan first
    // (covers Zomaal-dispatched AND 3rd-party-carrier orders). trimmedValue,
    // not dto.value, is used consistently for every lookup below — a
    // barcode scanner appending a trailing newline must not make the final
    // order-reference fallback miss a real, stored order.
    const trimmedValue = dto.value.trim();
    let trackingNumber = trimmedValue;
    if (trimmedValue.startsWith('{')) {
      // Same contract as EcommerceService.resolveScannedCode: a QR payload
      // is either valid JSON with a trackingNumber, or a hard 400 — never
      // silently falls through to the order-reference lookup below, which
      // would turn a scanner malfunction into a confusing 404 instead of a
      // clear "this QR is broken" error.
      let payload: { trackingNumber?: unknown };
      try {
        payload = JSON.parse(trimmedValue) as { trackingNumber?: unknown };
      } catch {
        throw new BadRequestException('Scanned QR payload is not valid JSON');
      }
      if (typeof payload.trackingNumber !== 'string' || !payload.trackingNumber) {
        throw new BadRequestException('Scanned QR payload is missing trackingNumber');
      }
      trackingNumber = payload.trackingNumber;
    }

    const byDispatch = await this.prisma.ecommerceOrderDispatch.findFirst({
      where: { providerTracking: trackingNumber, order: { connection: { storeId } } },
      include: { order: { include: { lines: true } } },
    });
    if (byDispatch) return byDispatch.order;

    const byTracking = await this.prisma.ecommerceOrderEvent.findFirst({
      where: {
        order: { connection: { storeId } },
        metadata: { path: ['number'], equals: trackingNumber },
      },
      include: { order: { include: { lines: true } } },
    });
    if (byTracking) return byTracking.order;

    // "Or enter order ID manually" fallback.
    const byReference = await this.prisma.ecommerceOrder.findFirst({
      where: {
        connection: { storeId },
        OR: [{ externalOrderId: trimmedValue }, { orderName: trimmedValue }],
      },
      include: { lines: true },
    });
    if (byReference) return byReference;

    throw new NotFoundException('No order matches this code');
  }

  private async resolveCustomer(
    userId: string,
    order: {
      id: string;
      connectionId: string;
      manualCustomerName: string | null;
      manualCustomerPhone: string | null;
      manualShippingAddress: string | null;
    },
  ) {
    if (order.manualCustomerName || order.manualCustomerPhone) {
      return {
        name: order.manualCustomerName,
        phone: order.manualCustomerPhone,
        address: order.manualShippingAddress,
      };
    }
    try {
      const preview = await this.ecommerceService.getFulfillmentPreview(userId, order.id);
      return {
        name: preview.recipientName,
        phone: preview.recipientPhone,
        address: [preview.address, preview.city, preview.country].filter(Boolean).join(', ') || null,
      };
    } catch {
      // Platform temporarily unreachable — the return can still be
      // processed without customer info displayed; never block on this.
      return { name: null, phone: null, address: null };
    }
  }


  private computeLoss(lines: OrderLineForLoss[], deliveryCost: Prisma.Decimal) {
    const originalOrderValue = lines.reduce(
      (sum, l) => sum.plus(l.totalPrice),
      new Prisma.Decimal(0),
    );
    const itemLoss = lines.reduce((sum, l) => {
      switch (l.condition) {
        case ProductCondition.DAMAGED:
          return sum.plus(l.damageCost ?? new Prisma.Decimal(0));
        case ProductCondition.LOST:
        case ProductCondition.MISSING:
          return sum.plus(l.totalPrice);
        default:
          return sum; // GOOD/RETURNED/unset — no item loss
      }
    }, new Prisma.Decimal(0));

    return {
      originalOrderValue: originalOrderValue.toFixed(2),
      deliveryCost: deliveryCost.toFixed(2),
      netLoss: deliveryCost.plus(itemLoss).toFixed(2),
    };
  }

  private presentStatus(returnRequest: {
    status: ReturnRequestStatus;
    createdAt: Date;
  }): 'NEED_VERIFICATION' | 'DELAYED' | 'PROCESSED' {
    if (returnRequest.status === ReturnRequestStatus.PROCESSED) {
      return 'PROCESSED';
    }
    return returnRequest.createdAt.getTime() < Date.now() - DELAYED_AFTER_MS
      ? 'DELAYED'
      : 'NEED_VERIFICATION';
  }

  private async requireStore(userId: string): Promise<{ id: string }> {
    const store = await this.prisma.store.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    return store;
  }
}

