import { BadRequestException } from '@nestjs/common';
import { InventoryBucket } from '@prisma/client';
import { InventoryService } from './inventory.service';

describe('InventoryService', () => {
  it('returns an existing movement without changing stock again', async () => {
    const movement = { id: 'movement-1', quantityDelta: 3 };
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'item-1',
          balances: [],
        }),
      },
      inventoryMovement: {
        findUnique: jest.fn().mockResolvedValue(movement),
        create: jest.fn(),
      },
      inventoryBalance: { create: jest.fn(), update: jest.fn() },
      warehouseLocation: { upsert: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new InventoryService(prisma as never, stores as never);

    await expect(
      service.adjust('user-1', 'item-1', {
        bucket: InventoryBucket.ON_HAND,
        quantityDelta: 3,
        reason: 'Correction',
        idempotencyKey: 'adjustment-123',
      }),
    ).resolves.toBe(movement);
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('prevents an adjustment from making inventory invalid', async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'item-1',
          balances: [
            {
              id: 'balance-1',
              locationId: 'location-1',
              location: { isDefault: true },
              onHand: 2,
              reserved: 0,
              damaged: 0,
              incoming: 0,
            },
          ],
        }),
      },
      inventoryMovement: { findUnique: jest.fn().mockResolvedValue(null) },
      inventoryBalance: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new InventoryService(prisma as never, stores as never);

    await expect(
      service.adjust('user-1', 'item-1', {
        bucket: InventoryBucket.ON_HAND,
        quantityDelta: -3,
        reason: 'Correction',
        idempotencyKey: 'adjustment-124',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inventoryBalance.update).not.toHaveBeenCalled();
  });

  it('sets an absolute stock quantity and audits the calculated delta', async () => {
    const tx = {
      inventoryItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'item-1',
          balances: [
            {
              id: 'balance-1',
              locationId: 'location-1',
              location: { isDefault: true },
              onHand: 47,
              reserved: 2,
              damaged: 1,
              incoming: 0,
            },
          ],
        }),
      },
      inventoryMovement: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args: { data: Record<string, unknown> }) =>
            Promise.resolve(args.data),
          ),
      },
      inventoryBalance: { update: jest.fn() },
    };
    const prisma = {
      $transaction: jest
        .fn()
        .mockImplementation((callback: (client: typeof tx) => unknown) =>
          callback(tx),
        ),
    };
    const stores = {
      requireStore: jest.fn().mockResolvedValue({ id: 'store-1' }),
    };
    const service = new InventoryService(prisma as never, stores as never);

    const result = await service.setOnHand('user-1', 'item-1', {
      quantity: 60,
      reason: 'Manual stock count',
      idempotencyKey: 'absolute-stock-001',
    });

    expect(tx.inventoryBalance.update).toHaveBeenCalledWith({
      where: { id: 'balance-1' },
      data: { onHand: 60, version: { increment: 1 } },
    });
    expect(result).toEqual(
      expect.objectContaining({
        quantityDelta: 13,
        resultingQuantity: 60,
        bucket: InventoryBucket.ON_HAND,
      }),
    );
  });
});
