import { Injectable, NotFoundException } from '@nestjs/common';
import { Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveCurrentStatus } from '../ecommerce/order-status.util';
import { OrderEventType } from '../ecommerce/constants/order-event-type';
import { CustomerListQueryDto } from './dto/customer-list-query.dto';
import {
  CustomerDetailResponseDto,
  CustomerListResponseDto,
  CustomerOrderHistoryItemDto,
  CustomerSummaryDto,
} from './dto/customer-response.dto';
import {
  AtRiskCustomerDto,
  BlacklistScreenResponseDto,
  BlacklistedCustomerDto,
} from './dto/blacklist.dto';
import { CustomerRiskService } from './customer-risk.service';
import {
  closestRiskProximity,
  computeRiskDistances,
} from './customer-risk.util';

const ORDER_HISTORY_LIMIT = 100;

// Covers every OrderEventType value (not just the ones that happened to
// show up in manual testing) plus the three EcommerceOrderStatus values
// used as the fallback when an order has no timeline events yet — a
// different, smaller vocabulary from OrderEventType, so both need entries.
const STATUS_LABEL: Record<string, string> = {
  [OrderEventType.ORDER_CREATED]: 'Order placed',
  [OrderEventType.ORDER_CONFIRMED]: 'Confirmed',
  [OrderEventType.ORDER_CANCELLED]: 'Cancelled',
  [OrderEventType.ORDER_CLOSED]: 'Closed',
  [OrderEventType.PAYMENT_PENDING]: 'Payment pending',
  [OrderEventType.PAYMENT_AUTHORIZED]: 'Payment authorized',
  [OrderEventType.PAYMENT_PAID]: 'Paid',
  [OrderEventType.PAYMENT_PARTIALLY_PAID]: 'Partially paid',
  [OrderEventType.PAYMENT_REFUNDED]: 'Refunded',
  [OrderEventType.PAYMENT_VOIDED]: 'Payment voided',
  [OrderEventType.FULFILLMENT_PENDING]: 'Pending fulfillment',
  [OrderEventType.FULFILLMENT_CREATED]: 'Fulfilled',
  [OrderEventType.LABEL_CREATED]: 'Shipping label created',
  [OrderEventType.PICKED_UP]: 'Picked up',
  [OrderEventType.IN_TRANSIT]: 'In transit',
  [OrderEventType.OUT_FOR_DELIVERY]: 'Out for delivery',
  [OrderEventType.DELIVERED]: 'Delivered',
  [OrderEventType.DELIVERY_FAILED]: 'Delivery failed',
  [OrderEventType.FULFILLMENT_CANCELLED]: 'Cancelled',
  [OrderEventType.RETURN_REQUESTED]: 'Return requested',
  [OrderEventType.RETURN_IN_TRANSIT]: 'Return in transit',
  [OrderEventType.RETURNED]: 'Returned',
  [OrderEventType.CUSTOMER_BLACKLISTED_WARNING]: 'Order placed',
  [OrderEventType.OTHER]: 'Updated',
  // EcommerceOrderStatus fallback values.
  CANCELLED: 'Cancelled',
  OPEN: 'Open',
  CLOSED: 'Closed',
};

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly risk: CustomerRiskService,
  ) {}

  async list(
    storeId: string,
    query: CustomerListQueryDto,
  ): Promise<CustomerListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const settings = await this.risk.getSettings(storeId);

    const search = query.search?.trim();
    const where = {
      storeId,
      ...(search && {
        OR: [
          { phone: { contains: search, mode: 'insensitive' as const } },
          { name: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    // Total/high-risk counts span every matching customer, not just this
    // page — computed here rather than in SQL so the "is this customer at
    // risk" rule stays defined in exactly one place (customer-risk.util).
    const allForCounts = await this.prisma.customer.findMany({
      where,
      select: {
        isBlacklisted: true,
        returnsCount: true,
        cancellationsCount: true,
        refusalsCount: true,
        noAnswerCount: true,
      },
    });
    const highRiskCount = allForCounts.filter(
      (c) =>
        !c.isBlacklisted &&
        closestRiskProximity(computeRiskDistances(c, settings)) !== null,
    ).length;

    const rows = await this.prisma.customer.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const customers: CustomerSummaryDto[] = rows.map((c) => ({
      id: c.id,
      phone: c.phone,
      name: c.name,
      address: this.formatAddress(c),
      totalOrders: c.totalOrders,
      isBlacklisted: c.isBlacklisted,
      isHighRisk:
        !c.isBlacklisted &&
        closestRiskProximity(computeRiskDistances(c, settings)) !== null,
    }));

    return {
      customers,
      totalCustomers: allForCounts.length,
      highRiskCount,
      page,
      limit,
    };
  }

  async getById(
    storeId: string,
    customerId: string,
  ): Promise<CustomerDetailResponseDto> {
    const customer = await this.requireCustomer(storeId, customerId);

    const orders = await this.prisma.ecommerceOrder.findMany({
      where: { customerId: customer.id },
      orderBy: { processedAt: 'desc' },
      take: ORDER_HISTORY_LIMIT,
      select: {
        id: true,
        orderName: true,
        processedAt: true,
        status: true,
        lines: { take: 1, select: { name: true } },
        events: { select: { type: true } },
      },
    });

    return {
      id: customer.id,
      phone: customer.phone,
      name: customer.name,
      address: this.formatAddress(customer),
      totalOrders: customer.totalOrders,
      riskScore: {
        returns: customer.returnsCount,
        cancellations: customer.cancellationsCount,
        refusals: customer.refusalsCount,
        noAnswer: customer.noAnswerCount,
        totalRiskActions:
          customer.returnsCount +
          customer.cancellationsCount +
          customer.refusalsCount +
          customer.noAnswerCount,
      },
      isBlacklisted: customer.isBlacklisted,
      blacklistReason: customer.blacklistReason,
      blacklistedAt: customer.blacklistedAt?.toISOString() ?? null,
      orders: orders.map(
        (order): CustomerOrderHistoryItemDto => ({
          orderId: order.id,
          orderName: order.orderName,
          productSummary: order.lines[0]?.name ?? null,
          status: this.displayStatus(order.events, order.status),
          occurredAt: order.processedAt.toISOString(),
        }),
      ),
    };
  }

  async getBlacklistScreen(
    storeId: string,
    search?: string,
  ): Promise<BlacklistScreenResponseDto> {
    const settings = await this.risk.getSettings(storeId);
    const trimmedSearch = search?.trim();
    const searchFilter = trimmedSearch
      ? {
          OR: [
            {
              phone: { contains: trimmedSearch, mode: 'insensitive' as const },
            },
            { name: { contains: trimmedSearch, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [totalBlacklisted, blacklisted, atRiskCandidates] = await Promise.all(
      [
        this.prisma.customer.count({
          where: { storeId, isBlacklisted: true },
        }),
        this.prisma.customer.findMany({
          where: { storeId, isBlacklisted: true, ...searchFilter },
          orderBy: { blacklistedAt: 'desc' },
        }),
        this.prisma.customer.findMany({
          where: { storeId, isBlacklisted: false, ...searchFilter },
        }),
      ],
    );

    const atRiskCustomers: AtRiskCustomerDto[] = atRiskCandidates
      .map((c) => {
        const proximity = closestRiskProximity(
          computeRiskDistances(c, settings),
        );
        return proximity
          ? { id: c.id, phone: c.phone, name: c.name, riskProximity: proximity }
          : null;
      })
      .filter((c): c is AtRiskCustomerDto => c !== null);

    const blacklistedCustomers: BlacklistedCustomerDto[] = blacklisted.map(
      (c) => ({
        id: c.id,
        phone: c.phone,
        name: c.name,
        returnsCount: c.returnsCount,
        cancellationsCount: c.cancellationsCount,
        refusalsCount: c.refusalsCount,
        noAnswerCount: c.noAnswerCount,
        blacklistedAt: (c.blacklistedAt ?? c.updatedAt).toISOString(),
      }),
    );

    return { totalBlacklisted, atRiskCustomers, blacklistedCustomers };
  }

  private async requireCustomer(
    storeId: string,
    customerId: string,
  ): Promise<Customer> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, storeId },
    });
    if (!customer) {
      throw new NotFoundException('Customer not found');
    }
    return customer;
  }

  private formatAddress(customer: {
    address: string | null;
    city: string | null;
  }): string | null {
    return [customer.address, customer.city].filter(Boolean).join(', ') || null;
  }

  private displayStatus(
    events: Array<{ type: string }>,
    fallbackStatus: string,
  ): string {
    const derived = deriveCurrentStatus(events) ?? fallbackStatus;
    return STATUS_LABEL[derived] ?? derived;
  }
}
