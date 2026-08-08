import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  InventoryBarcodeType,
  InventoryItemKind,
  WarehouseProductStatus,
} from '@prisma/client';
import { BarcodeService } from './barcode.service';

describe('BarcodeService', () => {
  const service = new BarcodeService({} as never, {} as never);

  it('accepts valid EAN-13 and rejects an invalid check digit', () => {
    expect(service.normalizeAndValidate('4006381333931')).toEqual({
      value: '4006381333931',
      type: InventoryBarcodeType.EAN_13,
    });
    expect(() => service.normalizeAndValidate('4006381333932')).toThrow(
      BadRequestException,
    );
  });

  it('normalizes a generated internal Code 128 value', () => {
    expect(service.normalizeAndValidate('zml-a1b2c3d4e5f6')).toEqual({
      value: 'ZML-A1B2C3D4E5F6',
      type: InventoryBarcodeType.INTERNAL_CODE_128,
    });
    expect(() =>
      service.normalizeAndValidate(
        'merchant-code',
        InventoryBarcodeType.INTERNAL_CODE_128,
      ),
    ).toThrow('must use the ZML generated format');
  });

  it('preserves merchant codes that do not claim to be GTINs', () => {
    expect(service.normalizeAndValidate('supplier-item-42')).toEqual({
      value: 'supplier-item-42',
      type: InventoryBarcodeType.OTHER,
    });
  });

  it('rejects Unicode, control, and invisible values that are unsafe for Code 128 scanners', () => {
    expect(() => service.normalizeAndValidate('supplier-مخزون')).toThrow(
      BadRequestException,
    );
    expect(() => service.normalizeAndValidate('supplier\u200Bcode')).toThrow(
      BadRequestException,
    );
    expect(() => service.normalizeAndValidate('supplier\ncode')).toThrow(
      BadRequestException,
    );
  });

  describe('resolveForUser', () => {
    const findFirst = jest.fn();
    const requireStore = jest.fn().mockResolvedValue({ id: 'store-1' });
    const resolver = new BarcodeService(
      { inventoryBarcode: { findFirst } } as never,
      { requireStore } as never,
    );

    beforeEach(() => jest.clearAllMocks());

    it('normalizes an internal scan and returns the exact variant with aggregate stock', async () => {
      findFirst.mockResolvedValue({
        id: 'barcode-1',
        value: 'ZML-A1B2C3D4E5F6',
        type: InventoryBarcodeType.INTERNAL_CODE_128,
        isPrimary: true,
        source: 'ZOMAAL',
        inventoryItemId: 'inventory-1',
        inventoryItem: {
          kind: InventoryItemKind.PRODUCT_VARIANT,
          variant: {
            id: 'variant-1',
            title: 'Black',
            sku: 'SKU-BLACK',
            price: 25,
            costPrice: 10,
            lowStockThreshold: 5,
            product: {
              id: 'product-1',
              name: 'Headphones',
              status: WarehouseProductStatus.ACTIVE,
            },
          },
          packagingMaterial: null,
          balances: [
            { onHand: 10, reserved: 2, damaged: 1, incoming: 4 },
            { onHand: 5, reserved: 1, damaged: 0, incoming: 0 },
          ],
        },
      });

      await expect(
        resolver.resolveForUser('user-1', ' zml-a1b2c3d4e5f6 '),
      ).resolves.toMatchObject({
        inventoryItemId: 'inventory-1',
        product: { id: 'product-1', name: 'Headphones' },
        variant: { id: 'variant-1', lowStockAlertThreshold: 5 },
        packagingMaterial: null,
        inventory: {
          onHand: 15,
          reserved: 3,
          damaged: 1,
          incoming: 4,
          available: 11,
        },
      });
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            storeId: 'store-1',
            value: 'ZML-A1B2C3D4E5F6',
          },
        }),
      );
    });

    it('does not reveal a barcode outside the current store', async () => {
      findFirst.mockResolvedValue(null);
      await expect(
        resolver.resolveForUser('user-1', 'SUPPLIER-CODE-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { storeId: 'store-1', value: 'SUPPLIER-CODE-1' },
        }),
      );
    });
  });
});
