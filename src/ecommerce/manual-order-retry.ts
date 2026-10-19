import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { CreateManualOrderDto } from './dto/create-manual-order.dto';

export const MANUAL_REQUEST_EVENT_ID = 'manual-request:v1';
export function manualOrderRequestHash(dto: CreateManualOrderDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        customerName: dto.customerName,
        customerPhone: dto.customerPhone,
        shippingAddress: dto.shippingAddress,
        shippingCity: dto.shippingCity ?? null,
        shippingCountry: dto.shippingCountry ?? null,
        notes: dto.notes ?? null,
        currency: dto.currency?.toUpperCase() ?? null,
        shippingCost: dto.shippingCost ?? 0,
        items: dto.items.map((item) => ({
          productCode: item.productCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice ?? null,
        })),
      }),
    )
    .digest('hex');
}

/** Compare against the original request, including on the concurrent retry path. */
export async function findManualOrderRetry(
  prisma: PrismaService,
  storeId: string,
  dto: CreateManualOrderDto,
): Promise<string | null> {
  if (!dto.idempotencyKey) return null;
  const order = await prisma.ecommerceOrder.findFirst({
    where: {
      externalOrderId: `MANUAL-${dto.idempotencyKey}`,
      connection: { storeId, platform: 'MANUAL' },
    },
    include: {
      lines: true,
      events: { where: { providerEventId: MANUAL_REQUEST_EVENT_ID }, take: 1 },
    },
  });
  if (!order) return null;
  const metadata = order.events[0]?.metadata;
  const fingerprint =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata.requestFingerprint
      : null;
  let matches: boolean;
  if (typeof fingerprint === 'string')
    matches = fingerprint === manualOrderRequestHash(dto);
  else {
    // Older orders predate request fingerprints. Compare their persisted
    // customer/line values without looking up today's catalog prices.
    const lines = [...order.lines].sort(
      (a, b) =>
        Number(a.externalLineId.replace('manual-', '')) -
        Number(b.externalLineId.replace('manual-', '')),
    );
    matches =
      order.manualCustomerName === dto.customerName &&
      order.manualCustomerPhone === dto.customerPhone &&
      order.manualShippingAddress === dto.shippingAddress &&
      order.shippingCity === (dto.shippingCity ?? null) &&
      order.manualShippingCountry === (dto.shippingCountry ?? null) &&
      order.manualNotes === (dto.notes ?? null) &&
      order.currency === (dto.currency?.toUpperCase() ?? order.currency) &&
      order.shipping.equals(new Prisma.Decimal(dto.shippingCost ?? 0)) &&
      lines.length === dto.items.length &&
      dto.items.every((item, index) => {
        const line = lines[index];
        return (
          line.sku === item.productCode &&
          line.quantity === item.quantity &&
          (item.unitPrice === undefined ||
            line.unitPrice.equals(new Prisma.Decimal(item.unitPrice)))
        );
      });
  }
  if (!matches)
    throw new ConflictException(
      'Idempotency key was already used with a different manual-order payload',
    );
  return order.id;
}
