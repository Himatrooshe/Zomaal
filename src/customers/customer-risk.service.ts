import { Injectable, NotFoundException } from '@nestjs/common';
import { BlacklistSettings, Customer } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateBlacklistSettingsDto } from './dto/blacklist.dto';
import {
  computeRiskDistances,
  hasCrossedRiskLimit,
} from './customer-risk.util';
// Plain constants file, no NestJS module involved — safe to import directly
// rather than duplicating the event type as a raw string.
import { OrderEventType } from '../ecommerce/constants/order-event-type';

export type RiskCategory =
  | 'RETURNS'
  | 'CANCELLATIONS'
  | 'REFUSALS'
  | 'NO_ANSWER';

const COUNTER_FIELD: Record<RiskCategory, keyof Customer> = {
  RETURNS: 'returnsCount',
  CANCELLATIONS: 'cancellationsCount',
  REFUSALS: 'refusalsCount',
  NO_ANSWER: 'noAnswerCount',
};

const CATEGORY_LABEL: Record<RiskCategory, string> = {
  RETURNS: 'return',
  CANCELLATIONS: 'cancellation',
  REFUSALS: 'refusal',
  NO_ANSWER: 'no-answer',
};

/**
 * Core Customer/BlacklistSettings engine. Reused by every place a risk
 * signal originates: e-commerce sync (Shopify/YouCan/Lightfunnels), the
 * Shopify webhook path, manual order creation, ReturnRequestService, and
 * each courier's status-transition webhook. None of those call sites live
 * in this module, so this stays free of any dependency on EcommerceModule/
 * ShippingModule to avoid a circular module dependency — callers there are
 * responsible for their own side effects (e.g. inserting the "blacklisted
 * customer placed a new order" SYSTEM timeline event) using the
 * isBlacklisted flag this returns.
 */
@Injectable()
export class CustomerRiskService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves-or-creates the Customer identified by (storeId, phone). Returns
   * null when there is no phone to identify them by — every call site must
   * treat that as "cannot track this order/shipment as a customer" rather
   * than fail the caller's own operation.
   */
  async upsertCustomer(params: {
    storeId: string;
    phone: string | null | undefined;
    name?: string | null;
    address?: string | null;
    city?: string | null;
  }): Promise<Customer | null> {
    const phone = params.phone?.trim();
    if (!phone) {
      return null;
    }

    return this.prisma.customer.upsert({
      where: { storeId_phone: { storeId: params.storeId, phone } },
      create: {
        storeId: params.storeId,
        phone,
        name: params.name?.trim() || null,
        address: params.address?.trim() || null,
        city: params.city?.trim() || null,
      },
      update: {
        ...(params.name !== undefined && {
          name: params.name?.trim() || null,
        }),
        ...(params.address !== undefined && {
          address: params.address?.trim() || null,
        }),
        ...(params.city !== undefined && { city: params.city?.trim() || null }),
      },
    });
  }

  /**
   * Called once per genuinely new order (not a re-sync of an existing one).
   * Bumps totalOrders and, if the customer is already blacklisted and the
   * store has "Warn on new order" on, writes a SYSTEM order-timeline event
   * directly (not via EcommerceOrderTimelineService — that service lives in
   * EcommerceModule, which ShopifyModule cannot depend on without a module
   * cycle, since EcommerceModule already depends on ShopifyModule; a single
   * upsert here needs no more than the Prisma access this service already
   * has). Every caller (sync, Shopify webhook, manual order creation)
   * shares this one implementation instead of duplicating the warning logic.
   */
  async recordNewOrder(params: {
    storeId: string;
    customerId: string;
    isBlacklisted: boolean;
    orderId: string;
    occurredAt: Date;
  }): Promise<void> {
    await this.prisma.customer.updateMany({
      where: { id: params.customerId },
      data: { totalOrders: { increment: 1 } },
    });

    if (!params.isBlacklisted) {
      return;
    }

    const settings = await this.getSettings(params.storeId);
    if (!settings.warnOnNewOrder) {
      return;
    }

    const occurredAt = Number.isNaN(params.occurredAt.getTime())
      ? new Date()
      : params.occurredAt;
    await this.prisma.ecommerceOrderEvent.upsert({
      where: {
        orderId_providerEventId: {
          orderId: params.orderId,
          providerEventId: `system-blacklist-warning-${params.orderId}`,
        },
      },
      create: {
        orderId: params.orderId,
        providerEventId: `system-blacklist-warning-${params.orderId}`,
        source: 'SYSTEM',
        type: OrderEventType.CUSTOMER_BLACKLISTED_WARNING,
        title: 'Blacklisted customer placed a new order',
        occurredAt,
        synthetic: false,
      },
      update: {}, // events are immutable once stored — never overwrite
    });
  }

  /**
   * Increments one risk counter and auto-blacklists if the store's
   * configured limit is crossed. Returns the customer's blacklist state
   * after the increment, so the caller can decide whether to surface a
   * warning (e.g. "blacklisted customer placed a new order").
   */
  async incrementRiskCounter(
    storeId: string,
    customerId: string,
    category: RiskCategory,
  ): Promise<{ isBlacklisted: boolean }> {
    const field = COUNTER_FIELD[category];
    const customer = await this.prisma.customer.update({
      where: { id: customerId },
      data: { [field]: { increment: 1 } },
    });

    if (customer.isBlacklisted) {
      return { isBlacklisted: true };
    }

    const settings = await this.getSettings(storeId);
    const crossed = this.evaluateThreshold(customer, settings);
    if (!crossed) {
      return { isBlacklisted: false };
    }

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        isBlacklisted: true,
        blacklistReason: this.autoBlacklistReason(customer),
        blacklistedAt: new Date(),
      },
    });
    return { isBlacklisted: true };
  }

  /**
   * The Refusals/No Answer counters, fed by Zomaal's own courier
   * integrations (Sendit/QuickLivraison/ForceLog/OzoneExpress/Ameex) —
   * scoped to those on purpose, see CustomerRiskService's class comment.
   * Shipments carry `userId`, not `storeId`, so this resolves the store
   * itself rather than making every one of the ~8 call sites across five
   * courier services do it. No-ops (never throws) when the user has no
   * store or no phone — a courier webhook must never 500 over this.
   */
  async recordShipmentOutcome(params: {
    userId: string;
    phone: string | null | undefined;
    name?: string | null;
    outcome: Extract<RiskCategory, 'REFUSALS' | 'NO_ANSWER'>;
  }): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { userId: params.userId },
      select: { id: true },
    });
    if (!store) return;

    const customer = await this.upsertCustomer({
      storeId: store.id,
      phone: params.phone,
      name: params.name,
    });
    if (!customer) return;

    await this.incrementRiskCounter(store.id, customer.id, params.outcome);
  }

  async addToBlacklist(
    storeId: string,
    customerId: string,
    reason?: string,
  ): Promise<Customer> {
    const customer = await this.requireCustomer(storeId, customerId);
    return this.prisma.customer.update({
      where: { id: customer.id },
      data: {
        isBlacklisted: true,
        blacklistReason: reason?.trim() || this.autoBlacklistReason(customer),
        blacklistedAt: new Date(),
      },
    });
  }

  /** Resets all four risk counters to zero — "monitored again from zero". */
  async removeFromBlacklist(
    storeId: string,
    customerId: string,
  ): Promise<Customer> {
    await this.requireCustomer(storeId, customerId);
    return this.prisma.customer.update({
      where: { id: customerId },
      data: {
        isBlacklisted: false,
        blacklistReason: null,
        blacklistedAt: null,
        returnsCount: 0,
        cancellationsCount: 0,
        refusalsCount: 0,
        noAnswerCount: 0,
      },
    });
  }

  /** Creates the default (all-zero, i.e. auto-blacklist off) row on first read. */
  async getSettings(storeId: string): Promise<BlacklistSettings> {
    return this.prisma.blacklistSettings.upsert({
      where: { storeId },
      create: { storeId },
      update: {},
    });
  }

  async updateSettings(
    storeId: string,
    dto: UpdateBlacklistSettingsDto,
  ): Promise<BlacklistSettings> {
    await this.getSettings(storeId); // ensure the row exists
    return this.prisma.blacklistSettings.update({
      where: { storeId },
      data: dto,
    });
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

  private evaluateThreshold(
    customer: Customer,
    settings: BlacklistSettings,
  ): boolean {
    return hasCrossedRiskLimit(computeRiskDistances(customer, settings));
  }

  private autoBlacklistReason(customer: Customer): string {
    const parts: string[] = [];
    if (customer.returnsCount > 0) {
      parts.push(
        `${customer.returnsCount} ${CATEGORY_LABEL.RETURNS}${customer.returnsCount === 1 ? '' : 's'}`,
      );
    }
    if (customer.cancellationsCount > 0) {
      parts.push(
        `${customer.cancellationsCount} ${CATEGORY_LABEL.CANCELLATIONS}${customer.cancellationsCount === 1 ? '' : 's'}`,
      );
    }
    if (customer.refusalsCount > 0) {
      parts.push(
        `${customer.refusalsCount} ${CATEGORY_LABEL.REFUSALS}${customer.refusalsCount === 1 ? '' : 's'}`,
      );
    }
    if (customer.noAnswerCount > 0) {
      parts.push(`${customer.noAnswerCount} ${CATEGORY_LABEL['NO_ANSWER']}`);
    }
    return parts.length > 0 ? parts.join(', ') : 'Risk threshold reached';
  }
}
