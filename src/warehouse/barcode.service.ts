import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryBarcodeType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { WarehouseStoreService } from './warehouse-store.service';

@Injectable()
export class BarcodeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: WarehouseStoreService,
  ) {}

  async generate(userId: string) {
    const store = await this.stores.requireStore(userId);
    return this.generateForStore(store.id);
  }

  async generateForStore(storeId: string) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const value = `ZML-${randomBytes(6).toString('hex').toUpperCase()}`;
      const exists = await this.prisma.inventoryBarcode.findFirst({
        where: { storeId, value },
        select: { id: true },
      });
      if (!exists) {
        return { value, type: InventoryBarcodeType.INTERNAL_CODE_128 };
      }
    }
    throw new BadRequestException('Unable to generate a unique barcode');
  }

  async validateForUser(
    userId: string,
    rawValue: string,
    requestedType?: InventoryBarcodeType,
  ) {
    const store = await this.stores.requireStore(userId);
    const barcode = this.normalizeAndValidate(rawValue, requestedType);
    const found = await this.prisma.inventoryBarcode.findFirst({
      where: { storeId: store.id, value: barcode.value },
      select: { id: true },
    });
    return { ...barcode, available: !found };
  }

  async resolveForUser(userId: string, rawValue: string) {
    const store = await this.stores.requireStore(userId);
    const value = normalizeScannedValue(rawValue);
    const barcode = await this.prisma.inventoryBarcode.findFirst({
      where: { storeId: store.id, value },
      include: {
        inventoryItem: {
          include: {
            variant: {
              include: {
                product: {
                  select: { id: true, name: true, status: true },
                },
              },
            },
            packagingMaterial: {
              select: { id: true, name: true, sku: true, isActive: true },
            },
            balances: {
              select: {
                onHand: true,
                reserved: true,
                damaged: true,
                incoming: true,
              },
            },
          },
        },
      },
    });
    if (!barcode) {
      throw new NotFoundException('Barcode was not found in this store');
    }

    const inventory = barcode.inventoryItem.balances.reduce<{
      onHand: number;
      reserved: number;
      damaged: number;
      incoming: number;
      available: number;
    }>(
      (total, balance) => ({
        onHand: total.onHand + balance.onHand,
        reserved: total.reserved + balance.reserved,
        damaged: total.damaged + balance.damaged,
        incoming: total.incoming + balance.incoming,
        available:
          total.available + balance.onHand - balance.reserved - balance.damaged,
      }),
      { onHand: 0, reserved: 0, damaged: 0, incoming: 0, available: 0 },
    );
    const variant = barcode.inventoryItem.variant;

    return {
      barcode: {
        id: barcode.id,
        value: barcode.value,
        type: barcode.type,
        isPrimary: barcode.isPrimary,
        source: barcode.source,
      },
      inventoryItemId: barcode.inventoryItemId,
      inventoryItemKind: barcode.inventoryItem.kind,
      product: variant?.product ?? null,
      variant: variant
        ? {
            id: variant.id,
            title: variant.title,
            sku: variant.sku,
            price: Number(variant.price),
            costPrice: Number(variant.costPrice),
            lowStockAlertThreshold: variant.lowStockThreshold,
          }
        : null,
      packagingMaterial: barcode.inventoryItem.packagingMaterial,
      inventory,
    };
  }

  normalizeAndValidate(rawValue: string, requestedType?: InventoryBarcodeType) {
    const value = rawValue.normalize('NFKC').trim();
    if (!value || value.length > 100 || !isPrintableAscii(value)) {
      throw new BadRequestException('Barcode contains invalid characters');
    }
    const type = requestedType ?? inferBarcodeType(value);
    if (
      type === InventoryBarcodeType.INTERNAL_CODE_128 &&
      !/^ZML-[A-F0-9]{12}$/i.test(value)
    ) {
      throw new BadRequestException(
        'Internal Code 128 barcode must use the ZML generated format',
      );
    }
    if (type === InventoryBarcodeType.EAN_13 && !isValidGtin(value, 13)) {
      throw new BadRequestException(
        'EAN-13 barcode has an invalid check digit',
      );
    }
    if (type === InventoryBarcodeType.UPC_A && !isValidGtin(value, 12)) {
      throw new BadRequestException('UPC-A barcode has an invalid check digit');
    }
    if (
      type === InventoryBarcodeType.GTIN &&
      ![8, 12, 13, 14].some((length) => isValidGtin(value, length))
    ) {
      throw new BadRequestException(
        'GTIN barcode has an invalid format or check digit',
      );
    }
    return {
      value:
        type === InventoryBarcodeType.INTERNAL_CODE_128
          ? value.toUpperCase()
          : value,
      type,
    };
  }
}

export function normalizeScannedValue(rawValue: string): string {
  const value = rawValue.normalize('NFKC').trim();
  if (!value || value.length > 100 || !isPrintableAscii(value)) {
    throw new BadRequestException('Barcode contains invalid characters');
  }
  return /^ZML-[A-F0-9]{12}$/i.test(value) ? value.toUpperCase() : value;
}

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7E]+$/.test(value);
}

function inferBarcodeType(value: string): InventoryBarcodeType {
  if (/^ZML-[A-F0-9]{12}$/i.test(value)) {
    return InventoryBarcodeType.INTERNAL_CODE_128;
  }
  if (/^\d{13}$/.test(value)) return InventoryBarcodeType.EAN_13;
  if (/^\d{12}$/.test(value)) return InventoryBarcodeType.UPC_A;
  if (/^\d{8}$|^\d{14}$/.test(value)) return InventoryBarcodeType.GTIN;
  return InventoryBarcodeType.OTHER;
}

function isValidGtin(value: string, length: number): boolean {
  if (!new RegExp(`^\\d{${length}}$`).test(value)) return false;
  const digits = [...value].map(Number);
  const expected = digits.pop();
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );
  return expected === (10 - (sum % 10)) % 10;
}
