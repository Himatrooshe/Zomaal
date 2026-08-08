import { PackagingService } from './packaging.service';

describe('PackagingService', () => {
  it('resolves an image object only for an active material owned by the store', async () => {
    const prisma = {
      packagingMaterial: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ imageObjectName: 'shop/packaging/box.webp' }),
      },
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new PackagingService(prisma as never, stores as never);

    await expect(
      service.requireImageObject(
        'user-1',
        '2d5e2688-0818-429a-bb03-8351130c60ea',
      ),
    ).resolves.toBe('shop/packaging/box.webp');
    expect(prisma.packagingMaterial.findFirst).toHaveBeenCalledWith({
      where: {
        id: '2d5e2688-0818-429a-bb03-8351130c60ea',
        storeId: 'store-1',
        isActive: true,
        imageObjectName: { not: null },
      },
      select: { imageObjectName: true },
    });
  });

  it('hides missing or unowned packaging images', async () => {
    const prisma = {
      packagingMaterial: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new PackagingService(prisma as never, stores as never);

    await expect(
      service.requireImageObject(
        'user-1',
        '2d5e2688-0818-429a-bb03-8351130c60ea',
      ),
    ).rejects.toThrow('Packaging image not found');
  });

  it('does not credit the same delivered shop item twice', async () => {
    const existingMovement = { id: 'movement-1', resultingQuantity: 20 };
    const tx = {
      warehouseLocation: {
        upsert: jest.fn().mockResolvedValue({ id: 'location-1' }),
      },
      packagingMaterial: {
        upsert: jest.fn().mockResolvedValue({ id: 'material-1' }),
      },
      inventoryItem: {
        upsert: jest.fn().mockResolvedValue({ id: 'inventory-1' }),
      },
      inventoryMovement: {
        findUnique: jest.fn().mockResolvedValue(existingMovement),
        create: jest.fn(),
      },
      inventoryBalance: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const service = new PackagingService(prisma as never, {} as never);

    await expect(
      service.creditDeliveredPurchase('store-1', {
        zomaalShopVariantId: 'shop-variant-1',
        name: 'Large box',
        quantity: 20,
        deliveryReference: 'delivery-1',
      }),
    ).resolves.toBe(existingMovement);
    expect(tx.inventoryBalance.upsert).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('rejects non-positive delivery quantities before touching the database', async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new PackagingService(prisma as never, {} as never);

    await expect(
      service.creditDeliveredPurchase('store-1', {
        zomaalShopVariantId: 'shop-variant-1',
        name: 'Large box',
        quantity: 0,
        deliveryReference: 'delivery-1',
      }),
    ).rejects.toThrow('positive integer');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
