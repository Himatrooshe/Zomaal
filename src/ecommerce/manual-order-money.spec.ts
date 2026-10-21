import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EcommerceService } from './ecommerce.service';

describe('Manual order monetary overflow', () => {
  it.each([
    { quantity: 1, unitPrice: 1e20, shippingCost: 0, lines: 1 },
    { quantity: 1, unitPrice: 1, shippingCost: 1e20, lines: 1 },
    { quantity: 1000, unitPrice: 1e15, shippingCost: 0, lines: 1 },
    { quantity: 1, unitPrice: 6e15, shippingCost: 0, lines: 2 },
    { quantity: 1, unitPrice: 6e15, shippingCost: 6e15, lines: 1 },
  ])(
    'rejects $lines line(s) × $quantity × $unitPrice plus $shippingCost before any customer write',
    async ({ quantity, unitPrice, shippingCost, lines }) => {
      const upsertCustomer = jest.fn();
      const transaction = jest.fn();
      const prisma = {
        warehouseVariant: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'variant',
              productCode: 'PRODUCT1',
              price: new Prisma.Decimal(1),
              product: { name: 'Product' },
            },
          ]),
        },
        $transaction: transaction,
      };
      const service = new EcommerceService(
        prisma as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        { upsertCustomer } as never,
        {
          requireStore: jest
            .fn()
            .mockResolvedValue({ id: 'store', baseCurrency: 'MAD' }),
        } as never,
        {} as never,
        {} as never,
      );
      await expect(
        service.createManualOrder('owner', {
          customerName: 'Test',
          customerPhone: 'test-phone',
          shippingAddress: 'Test',
          shippingCost,
          items: Array.from({ length: lines }, () => ({
            productCode: 'PRODUCT1',
            quantity,
            unitPrice,
          })),
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upsertCustomer).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
