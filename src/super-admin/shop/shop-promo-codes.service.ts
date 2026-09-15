import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ShopOrderStatus,
  ShopPromoCode,
  ShopPromoType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import type {
  CreateShopPromoCodeDto,
  UpdateShopPromoCodeDto,
} from './dto/storefront-admin.dto';

const dec = (v: number | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Prisma.Decimal(v);

@Injectable()
export class ShopPromoCodesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogService,
  ) {}

  async list() {
    const codes = await this.prisma.shopPromoCode.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const revenue = await this.prisma.shopOrder.groupBy({
      by: ['promoCodeId'],
      where: {
        promoCodeId: { not: null },
        status: { not: ShopOrderStatus.CANCELLED },
      },
      _sum: { discount: true },
      _count: { _all: true },
    });
    const stats = new Map(revenue.map((r) => [r.promoCodeId, r]));
    return codes.map((c) => ({
      ...this.toResponse(c),
      ordersCount: stats.get(c.id)?._count._all ?? 0,
      totalDiscountGiven: (
        stats.get(c.id)?._sum.discount ?? new Prisma.Decimal(0)
      ).toFixed(2),
    }));
  }

  async create(actor: SuperAdminJwtPayload, dto: CreateShopPromoCodeDto) {
    const code = dto.code.trim().toUpperCase();
    this.validate({
      type: dto.type,
      value: dto.value,
      startsAt: dto.startsAt,
      endsAt: dto.endsAt,
    });
    if (
      await this.prisma.shopPromoCode.findUnique({
        where: { code },
        select: { id: true },
      })
    ) {
      throw new ConflictException(`Promo code ${code} already exists.`);
    }
    const promo = await this.prisma.shopPromoCode.create({
      data: {
        code,
        description: dto.description?.trim() || null,
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        minSubtotal: dec(dto.minSubtotal) ?? null,
        maxDiscount:
          dto.type === ShopPromoType.PERCENT
            ? (dec(dto.maxDiscount) ?? null)
            : null,
        usageLimit: dto.usageLimit ?? null,
        perStoreLimit: dto.perStoreLimit ?? null,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
        isActive: dto.isActive ?? true,
      },
    });
    await this.log(
      actor,
      'PROMO_CREATED',
      promo,
      `Created promo code ${promo.code}`,
    );
    return this.toResponse(promo);
  }

  async update(
    actor: SuperAdminJwtPayload,
    id: string,
    dto: UpdateShopPromoCodeDto,
  ) {
    const before = await this.require(id);
    const type = dto.type ?? before.type;
    const value = dto.value ?? before.value.toNumber();
    this.validate({
      type,
      value,
      startsAt:
        dto.startsAt !== undefined
          ? dto.startsAt
          : before.startsAt?.toISOString(),
      endsAt:
        dto.endsAt !== undefined ? dto.endsAt : before.endsAt?.toISOString(),
    });
    let code: string | undefined;
    if (dto.code !== undefined) {
      code = dto.code.trim().toUpperCase();
      const clash = await this.prisma.shopPromoCode.findFirst({
        where: { code, id: { not: id } },
        select: { id: true },
      });
      if (clash)
        throw new ConflictException(`Promo code ${code} already exists.`);
    }
    const promo = await this.prisma.shopPromoCode.update({
      where: { id },
      data: {
        ...(code ? { code } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description?.trim() || null }
          : {}),
        type,
        value: new Prisma.Decimal(value),
        ...(dto.minSubtotal !== undefined
          ? { minSubtotal: dec(dto.minSubtotal) }
          : {}),
        maxDiscount:
          type === ShopPromoType.PERCENT
            ? dto.maxDiscount !== undefined
              ? dec(dto.maxDiscount)
              : before.maxDiscount
            : null,
        ...(dto.usageLimit !== undefined ? { usageLimit: dto.usageLimit } : {}),
        ...(dto.perStoreLimit !== undefined
          ? { perStoreLimit: dto.perStoreLimit }
          : {}),
        ...(dto.startsAt !== undefined
          ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null }
          : {}),
        ...(dto.endsAt !== undefined
          ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
    await this.log(
      actor,
      'PROMO_UPDATED',
      promo,
      `Updated promo code ${promo.code}`,
    );
    return this.toResponse(promo);
  }

  // Orders keep the code text they used (ShopOrder.promoCode), so deleting a
  // promo never changes past orders.
  async remove(actor: SuperAdminJwtPayload, id: string) {
    const promo = await this.require(id);
    await this.prisma.shopPromoCode.delete({ where: { id } });
    await this.log(
      actor,
      'PROMO_DELETED',
      promo,
      `Deleted promo code ${promo.code}`,
    );
    return { message: `Promo code ${promo.code} deleted` };
  }

  private validate(p: {
    type: ShopPromoType;
    value: number;
    startsAt?: string | null;
    endsAt?: string | null;
  }) {
    if (p.type === ShopPromoType.PERCENT && (p.value <= 0 || p.value > 100)) {
      throw new BadRequestException(
        'A percentage discount must be between 1 and 100.',
      );
    }
    if (p.startsAt && p.endsAt && new Date(p.endsAt) <= new Date(p.startsAt)) {
      throw new BadRequestException(
        'The end date must be after the start date.',
      );
    }
  }

  private async require(id: string) {
    const promo = await this.prisma.shopPromoCode.findUnique({ where: { id } });
    if (!promo) throw new NotFoundException('Promo code not found');
    return promo;
  }

  private log(
    actor: SuperAdminJwtPayload,
    action: string,
    promo: ShopPromoCode,
    summary: string,
  ) {
    return this.activity.record(actor, {
      action,
      entityType: ActivityEntity.SHOP_PROMO,
      entityId: promo.id,
      summary,
    });
  }

  toResponse(p: ShopPromoCode) {
    const now = new Date();
    const status = !p.isActive
      ? 'INACTIVE'
      : p.startsAt && p.startsAt > now
        ? 'SCHEDULED'
        : p.endsAt && p.endsAt < now
          ? 'EXPIRED'
          : p.usageLimit !== null && p.usedCount >= p.usageLimit
            ? 'USED_UP'
            : 'ACTIVE';
    return {
      id: p.id,
      code: p.code,
      description: p.description,
      type: p.type,
      value: p.value.toFixed(2),
      minSubtotal: p.minSubtotal?.toFixed(2) ?? null,
      maxDiscount: p.maxDiscount?.toFixed(2) ?? null,
      usageLimit: p.usageLimit,
      perStoreLimit: p.perStoreLimit,
      usedCount: p.usedCount,
      startsAt: p.startsAt?.toISOString() ?? null,
      endsAt: p.endsAt?.toISOString() ?? null,
      isActive: p.isActive,
      status,
      createdAt: p.createdAt.toISOString(),
    };
  }
}
