import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Prisma,
  ShopOrderCancelledBy,
  ShopOrderStatus,
  ShopPaymentMethod,
  ShopPromoCode,
  ShopSettings,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StoreAccess } from '../access/store-access.service';
import { assertPersistedMoney } from '../common/persisted-money';
import { lockShopStore, lockShopProducts } from './shop-lock.util';
import { AddressService } from './address.service';
import { CartService, type EvaluatedLine } from './cart.service';
import { ShopOrdersService, ORDER_INCLUDE } from './shop-orders.service';
import { ShopSettingsService } from './shop-settings.service';
import { imageUrl } from './shop-catalog.util';
import {
  priceOrder,
  checkPromo,
  promoRejectionMessage,
  variantLabel,
} from './shop-pricing.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_UNAVAILABLE =
  'Online payment is not available yet. Please use Cash on Delivery.';

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: ShopSettingsService,
    private readonly cart: CartService,
    private readonly addresses: AddressService,
    private readonly orders: ShopOrdersService,
  ) {}

  /** "Repeated cancellations may restrict your account." */
  async codRestriction(
    storeId: string,
    settings: ShopSettings,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const limit = settings.codCancellationLimit;
    const windowDays = settings.codCancellationWindowDays;
    const cancellations = await db.shopOrder.count({
      where: {
        storeId,
        paymentMethod: ShopPaymentMethod.COD,
        cancelledAt: { gte: new Date(Date.now() - windowDays * DAY_MS) },
        // Merchant cancellations, plus COD orders refused on delivery (an
        // admin cancels an order that had already shipped).
        OR: [
          { cancelledBy: ShopOrderCancelledBy.MERCHANT },
          {
            cancelledBy: ShopOrderCancelledBy.ADMIN,
            shippedAt: { not: null },
          },
        ],
      },
    });
    return {
      cancellations,
      limit,
      windowDays,
      restricted: limit > 0 && cancellations >= limit,
    };
  }

  private async loadPromo(
    code: string | undefined,
    storeId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const normalized = code?.trim().toUpperCase();
    if (!normalized) return null;
    const promo = await db.shopPromoCode.findUnique({
      where: { code: normalized },
    });
    const storeUses = promo
      ? await db.shopOrder.count({
          where: {
            storeId,
            promoCodeId: promo.id,
            status: { not: ShopOrderStatus.CANCELLED },
          },
        })
      : 0;
    return { promo, code: normalized, storeUses };
  }

  private async compute(
    access: StoreAccess,
    input: { promoCode?: string; addressId?: string },
    db?: Prisma.TransactionClient,
  ) {
    const [settings, rows, store] = await Promise.all([
      db
        ? db.shopSettings.findUniqueOrThrow({ where: { id: 'default' } })
        : this.settingsService.get(),
      this.cart.rows(access.storeId, db),
      (db ?? this.prisma).store.findUniqueOrThrow({
        where: { id: access.storeId },
        select: { isActive: true },
      }),
    ]);
    const lines = this.cart.evaluate(rows);
    const promoCtx = await this.loadPromo(input.promoCode, access.storeId, db);
    const pricing = priceOrder({
      lines: lines
        .filter((l) => !l.problem)
        .map((l) => ({ unitPrice: l.unitPrice, quantity: l.row.quantity })),
      settings,
      promo: promoCtx
        ? {
            input: promoCtx.promo,
            code: promoCtx.code,
            storeUses: promoCtx.storeUses,
          }
        : null,
    });
    for (const [field, value] of Object.entries({
      subtotal: pricing.subtotal,
      discount: pricing.discount,
      deliveryFee: pricing.deliveryFee,
      total: pricing.total,
    }))
      assertPersistedMoney(value, field);
    for (const line of lines)
      assertPersistedMoney(
        line.unitPrice.times(line.row.quantity).toDecimalPlaces(2),
        'lineTotal',
      );
    const address = input.addressId
      ? await this.addresses.require(access.storeId, input.addressId, db)
      : await this.addresses.defaultFor(access.storeId, db);
    const cod = await this.codRestriction(access.storeId, settings, db);
    return {
      settings,
      lines,
      pricing,
      promoCtx,
      address,
      cod,
      storeActive: store.isActive,
    };
  }

  async preview(
    access: StoreAccess,
    input: { promoCode?: string; addressId?: string },
  ) {
    const { settings, lines, pricing, address, cod, storeActive } =
      await this.compute(access, input);

    const blockers: { code: string; message: string }[] = [];
    if (!storeActive)
      blockers.push({
        code: 'ACCOUNT_SUSPENDED',
        message: 'Your account is suspended. Contact Zomaal support.',
      });
    if (lines.length === 0)
      blockers.push({ code: 'CART_EMPTY', message: 'Your cart is empty.' });
    if (lines.some((l) => l.problem))
      blockers.push({
        code: 'CART_HAS_PROBLEMS',
        message: 'Some items in your cart are unavailable or out of stock.',
      });
    if (!address)
      blockers.push({
        code: 'ADDRESS_REQUIRED',
        message: 'Add a delivery address.',
      });
    const codAvailable = settings.codEnabled && !cod.restricted;
    if (!codAvailable) {
      blockers.push({
        code: cod.restricted ? 'COD_RESTRICTED' : 'COD_DISABLED',
        message: cod.restricted
          ? `Cash on Delivery is paused for your account after ${cod.cancellations} cancelled orders in the last ${cod.windowDays} days.`
          : 'Cash on Delivery is currently unavailable.',
      });
    }

    return {
      currency: settings.currency,
      items: lines.map((l) => this.cart.lineResponse(l, settings.currency)),
      address: address ? this.addresses.toResponse(address) : null,
      pricing: {
        subtotal: pricing.subtotal.toFixed(2),
        discount: pricing.discount.toFixed(2),
        deliveryFee: pricing.deliveryFee.toFixed(2),
        total: pricing.total.toFixed(2),
      },
      promo: pricing.promo,
      paymentMethods: [
        {
          method: ShopPaymentMethod.COD,
          available: codAvailable,
          reason: codAvailable
            ? null
            : blockers.find((b) => b.code.startsWith('COD_'))!.message,
        },
        {
          method: ShopPaymentMethod.ONLINE,
          available: false,
          reason: ONLINE_UNAVAILABLE,
        },
      ],
      codRestriction: cod,
      canPlaceOrder: blockers.length === 0,
      blockers,
    };
  }

  async placeOrder(
    access: StoreAccess,
    dto: {
      addressId: string;
      paymentMethod: ShopPaymentMethod;
      promoCode?: string;
      note?: string;
    },
  ) {
    if (dto.paymentMethod !== ShopPaymentMethod.COD) {
      throw new UnprocessableEntityException(ONLINE_UNAVAILABLE);
    }
    await this.settingsService.get();
    const orderId = await this.prisma.$transaction(
      async (tx) => {
        await lockShopStore(tx, access.storeId);
        const currentRows = await this.cart.rows(access.storeId, tx);
        await lockShopProducts(
          tx,
          currentRows.map((row) => row.productId),
        );
        const {
          settings,
          lines,
          pricing,
          promoCtx,
          address,
          cod,
          storeActive,
        } = await this.compute(access, dto, tx);

        if (!storeActive)
          throw new ForbiddenException(
            'Your account is suspended. Contact Zomaal support.',
          );
        if (!settings.codEnabled)
          throw new UnprocessableEntityException(
            'Cash on Delivery is currently unavailable.',
          );
        if (cod.restricted) {
          throw new ForbiddenException(
            `Cash on Delivery is paused for your account after ${cod.cancellations} cancelled orders in the last ${cod.windowDays} days.`,
          );
        }
        if (lines.length === 0)
          throw new BadRequestException('Your cart is empty.');
        const problem = lines.find((l) => l.problem);
        if (problem) {
          throw new ConflictException(
            `"${problem.row.product.name}" can't be ordered right now (${problem.problem!.toLowerCase().replace(/_/g, ' ')}). Update your cart and try again.`,
          );
        }
        if (!address) throw new BadRequestException('Add a delivery address.');
        // A promo the merchant typed must actually apply — never place an order
        // silently without the discount they expected.
        if (promoCtx && !pricing.promo?.applied) {
          throw new UnprocessableEntityException(
            pricing.promo?.message ?? promoRejectionMessage('NOT_FOUND'),
          );
        }

        // Claim the cart rows first. A double-tapped "Confirm Order" runs this
        // twice: the second transaction waits on the row locks, then finds
        // the rows gone and rolls back instead of creating a duplicate order.
        const claimed = await tx.shopCartItem.deleteMany({
          where: {
            storeId: access.storeId,
            id: { in: lines.map((l) => l.row.id) },
          },
        });
        if (claimed.count !== lines.length) {
          throw new ConflictException(
            'Your cart changed while placing the order. Review it and try again.',
          );
        }

        await this.reserveStock(tx, lines);

        if (promoCtx?.promo && pricing.promo?.applied) {
          await this.claimPromo(
            tx,
            promoCtx.promo,
            access.storeId,
            pricing.subtotal,
          );
        }

        const order = await tx.shopOrder.create({
          data: {
            storeId: access.storeId,
            placedByUserId: access.userId,
            paymentMethod: ShopPaymentMethod.COD,
            currency: settings.currency,
            subtotal: pricing.subtotal,
            discount: pricing.discount,
            deliveryFee: pricing.deliveryFee,
            total: pricing.total,
            promoCodeId: pricing.promo?.applied ? promoCtx!.promo!.id : null,
            promoCode: pricing.promo?.applied ? promoCtx!.code : null,
            shipLabel: address.label,
            shipName: address.fullName,
            shipPhone: address.phone,
            shipCountry: address.country,
            shipCity: address.city,
            shipDistrict: address.district,
            shipAddress: address.address,
            note: dto.note?.trim() || null,
            items: {
              create: lines.map((l) => ({
                productId: l.row.productId,
                variantId: l.row.variantId,
                productName: l.row.product.name,
                variantLabel: variantLabel(l.row.variant),
                unitLabel: l.row.product.unitLabel,
                imageUrl: l.row.product.images[0]
                  ? imageUrl(l.row.product.images[0].id)
                  : null,
                unitPrice: l.unitPrice,
                quantity: l.row.quantity,
                lineTotal: l.unitPrice.times(l.row.quantity).toDecimalPlaces(2),
              })),
            },
          },
          select: { id: true },
        });
        return order.id;
      },
      { timeout: 20_000 },
    );

    const order = await this.prisma.shopOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: ORDER_INCLUDE,
    });
    return this.orders.toMerchantResponse(order);
  }

  // Conditional decrements: the update only matches while enough stock
  // remains, so concurrent orders can never oversell. Any shortfall rolls the
  // whole order back.
  private async reserveStock(
    tx: Prisma.TransactionClient,
    lines: EvaluatedLine[],
  ) {
    const touchedProducts = new Set<string>();
    for (const l of lines) {
      const qty = l.row.quantity;
      if (l.row.variantId) {
        const r = await tx.shopProductVariant.updateMany({
          where: { id: l.row.variantId, isActive: true, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });
        if (!r.count) throw this.stockConflict(tx, l);
        touchedProducts.add(l.row.productId);
      } else {
        const r = await tx.shopProduct.updateMany({
          where: { id: l.row.productId, stock: { gte: qty } },
          data: { stock: { decrement: qty } },
        });
        if (!r.count) throw this.stockConflict(tx, l);
      }
    }
    // Keep product.stock equal to the sum of its variants.
    for (const productId of touchedProducts) {
      const sum = await tx.shopProductVariant.aggregate({
        where: { productId },
        _sum: { stock: true },
      });
      await tx.shopProduct.update({
        where: { id: productId },
        data: { stock: sum._sum.stock ?? 0 },
      });
    }
  }

  private stockConflict(_tx: Prisma.TransactionClient, l: EvaluatedLine) {
    return new ConflictException(
      `"${l.row.product.name}" just sold out or doesn't have ${l.row.quantity} left. Update your cart and try again.`,
    );
  }

  // The store lock serializes per-store use; the promo row lock serializes global use.
  private async claimPromo(
    tx: Prisma.TransactionClient,
    promo: ShopPromoCode,
    storeId: string,
    subtotal: Prisma.Decimal,
  ) {
    await tx.$queryRaw`SELECT id FROM "ShopPromoCode" WHERE id = ${promo.id} FOR UPDATE`;
    const current = await tx.shopPromoCode.findUnique({
      where: { id: promo.id },
    });
    const storeUses = await tx.shopOrder.count({
      where: {
        storeId,
        promoCodeId: promo.id,
        status: { not: ShopOrderStatus.CANCELLED },
      },
    });
    const rejection = checkPromo(current, {
      subtotal,
      storeUses,
      now: new Date(),
    });
    // Prevent silently applying an old discount if an admin changed the offer mid-checkout.
    if (
      rejection ||
      !current ||
      !current.value.equals(promo.value) ||
      current.type !== promo.type ||
      String(current.maxDiscount) !== String(promo.maxDiscount) ||
      String(current.minSubtotal) !== String(promo.minSubtotal)
    ) {
      throw new UnprocessableEntityException(
        rejection
          ? promoRejectionMessage(rejection, current)
          : 'Promo code changed. Preview checkout again.',
      );
    }
    await tx.shopPromoCode.update({
      where: { id: promo.id },
      data: { usedCount: { increment: 1 } },
    });
  }
}
