import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ShopProductStatus } from '@prisma/client';
import { CartService, MAX_LINE_QUANTITY, type CartRow } from './cart.service';

const SETTINGS = {
  currency: 'MAD',
  deliveryFee: new Prisma.Decimal(20),
  freeDeliveryMinSubtotal: null,
};

function build() {
  const prisma = {
    shopCartItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    shopProduct: { findUnique: jest.fn() },
  };
  const settings = { get: jest.fn().mockResolvedValue(SETTINGS) };
  const service = new CartService(prisma as never, settings as never);
  return { service, prisma, settings };
}

function row(overrides: Record<string, unknown> = {}): CartRow {
  return {
    id: 'row-1',
    storeId: 'store-1',
    productId: 'p1',
    variantId: null,
    quantity: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    variant: null,
    product: {
      id: 'p1',
      name: 'Box',
      unitLabel: 'piece',
      status: ShopProductStatus.ACTIVE,
      stock: 10,
      price: new Prisma.Decimal(10),
      compareAtPrice: null,
      category: { isActive: true },
      images: [],
      variants: [],
    },
    ...overrides,
  } as unknown as CartRow;
}

describe('CartService.evaluate', () => {
  it('flags UNAVAILABLE when the product is not active', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({ product: { ...row().product, status: ShopProductStatus.DRAFT } }),
    ]);
    expect(line.problem).toBe('UNAVAILABLE');
  });

  it('flags UNAVAILABLE when the category is inactive', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({ product: { ...row().product, category: { isActive: false } } }),
    ]);
    expect(line.problem).toBe('UNAVAILABLE');
  });

  it('flags UNAVAILABLE when the chosen variant was disabled', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({ variant: { id: 'v1', isActive: false, stock: 5 } }),
    ]);
    expect(line.problem).toBe('UNAVAILABLE');
  });

  it('flags VARIANT_REQUIRED when the product gained options after it was added', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({
        variant: null,
        product: {
          ...row().product,
          variants: [{ id: 'v1' }],
        },
      }),
    ]);
    expect(line.problem).toBe('VARIANT_REQUIRED');
  });

  it('flags OUT_OF_STOCK at zero stock', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({ product: { ...row().product, stock: 0 } }),
    ]);
    expect(line.problem).toBe('OUT_OF_STOCK');
  });

  it('flags INSUFFICIENT_STOCK when quantity exceeds stock', () => {
    const { service } = build();
    const [line] = service.evaluate([
      row({ quantity: 5, product: { ...row().product, stock: 3 } }),
    ]);
    expect(line.problem).toBe('INSUFFICIENT_STOCK');
  });

  it('is problem-free for a normal in-stock line', () => {
    const { service } = build();
    const [line] = service.evaluate([row()]);
    expect(line.problem).toBeNull();
    expect(line.unitPrice.toString()).toBe('10');
  });
});

describe('CartService.addItem', () => {
  it('requires a variant when the product has options', async () => {
    const { service, prisma } = build();
    prisma.shopProduct.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Shirt',
      status: ShopProductStatus.ACTIVE,
      stock: 10,
      category: { isActive: true },
      variants: [{ id: 'v1', isActive: true, stock: 5 }],
    });

    await expect(
      service.addItem('store-1', { productId: 'p1', quantity: 1 }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.shopCartItem.create).not.toHaveBeenCalled();
  });

  it('rejects a variantId on a product with no options', async () => {
    const { service, prisma } = build();
    prisma.shopProduct.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Box',
      status: ShopProductStatus.ACTIVE,
      stock: 10,
      category: { isActive: true },
      variants: [],
    });

    await expect(
      service.addItem('store-1', {
        productId: 'p1',
        variantId: 'v1',
        quantity: 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('merges into an existing line and checks the combined quantity against stock', async () => {
    const { service, prisma } = build();
    prisma.shopProduct.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Box',
      status: ShopProductStatus.ACTIVE,
      stock: 5,
      category: { isActive: true },
      variants: [],
    });
    prisma.shopCartItem.findFirst.mockResolvedValue({
      id: 'row-1',
      quantity: 3,
    });
    prisma.shopCartItem.findMany.mockResolvedValue([]);

    await expect(
      service.addItem('store-1', { productId: 'p1', quantity: 3 }),
    ).rejects.toThrow(ConflictException); // 3 + 3 = 6 > stock 5

    prisma.shopCartItem.findFirst.mockResolvedValue({
      id: 'row-1',
      quantity: 2,
    });
    await service.addItem('store-1', { productId: 'p1', quantity: 2 });
    expect(prisma.shopCartItem.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { quantity: 4 },
    });
    expect(prisma.shopCartItem.create).not.toHaveBeenCalled();
  });

  it('rejects a line quantity above MAX_LINE_QUANTITY even with plenty of stock', async () => {
    const { service, prisma } = build();
    prisma.shopProduct.findUnique.mockResolvedValue({
      id: 'p1',
      name: 'Box',
      status: ShopProductStatus.ACTIVE,
      stock: 1_000_000,
      category: { isActive: true },
      variants: [],
    });
    prisma.shopCartItem.findFirst.mockResolvedValue(null);

    await expect(
      service.addItem('store-1', {
        productId: 'p1',
        quantity: MAX_LINE_QUANTITY + 1,
      }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('CartService.updateItem', () => {
  it('always allows lowering the quantity, even below current stock', async () => {
    const { service, prisma } = build();
    prisma.shopCartItem.findFirst.mockResolvedValue({
      id: 'row-1',
      quantity: 10,
      variant: null,
      product: { name: 'Box', stock: 2 },
    });
    prisma.shopCartItem.findMany.mockResolvedValue([]);

    await service.updateItem('store-1', 'row-1', 3);
    expect(prisma.shopCartItem.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: { quantity: 3 },
    });
  });

  it('re-checks stock when raising the quantity', async () => {
    const { service, prisma } = build();
    prisma.shopCartItem.findFirst.mockResolvedValue({
      id: 'row-1',
      quantity: 2,
      variant: null,
      product: { name: 'Box', stock: 3 },
    });

    await expect(service.updateItem('store-1', 'row-1', 5)).rejects.toThrow(
      ConflictException,
    );
  });
});
