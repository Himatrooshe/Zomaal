import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SETTINGS_ID = 'default';

@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  // The row is seeded by the migration; upsert keeps this safe on a fresh
  // database or if the row was ever removed.
  get() {
    return this.prisma.shopSettings.upsert({
      where: { id: SETTINGS_ID },
      update: {},
      create: { id: SETTINGS_ID },
    });
  }

  async update(data: {
    currency?: string;
    deliveryFee?: number;
    freeDeliveryMinSubtotal?: number | null;
    codEnabled?: boolean;
    codCancellationLimit?: number;
    codCancellationWindowDays?: number;
  }) {
    await this.get();
    return this.prisma.shopSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        ...(data.currency !== undefined
          ? { currency: data.currency.trim().toUpperCase() }
          : {}),
        ...(data.deliveryFee !== undefined
          ? { deliveryFee: new Prisma.Decimal(data.deliveryFee) }
          : {}),
        ...(data.freeDeliveryMinSubtotal !== undefined
          ? {
              freeDeliveryMinSubtotal:
                data.freeDeliveryMinSubtotal === null
                  ? null
                  : new Prisma.Decimal(data.freeDeliveryMinSubtotal),
            }
          : {}),
        ...(data.codEnabled !== undefined
          ? { codEnabled: data.codEnabled }
          : {}),
        ...(data.codCancellationLimit !== undefined
          ? { codCancellationLimit: data.codCancellationLimit }
          : {}),
        ...(data.codCancellationWindowDays !== undefined
          ? { codCancellationWindowDays: data.codCancellationWindowDays }
          : {}),
      },
    });
  }

  toResponse(s: Awaited<ReturnType<ShopSettingsService['get']>>) {
    return {
      currency: s.currency,
      deliveryFee: s.deliveryFee.toFixed(2),
      freeDeliveryMinSubtotal: s.freeDeliveryMinSubtotal?.toFixed(2) ?? null,
      codEnabled: s.codEnabled,
      onlinePaymentAvailable: false,
      codCancellationLimit: s.codCancellationLimit,
      codCancellationWindowDays: s.codCancellationWindowDays,
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
