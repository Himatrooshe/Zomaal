import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from '../../common/validation-pipe.options';
import { CreateManualOrderDto } from './create-manual-order.dto';
import { EcommerceOrderQueryDto } from './ecommerce-order-query.dto';
import { EcommerceOrderExportQueryDto } from './ecommerce-order-export-query.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const validOrder = {
  customerName: 'Test customer',
  customerPhone: '+212612345678',
  shippingAddress: 'Test address',
  items: [{ productCode: 'PRODUCT1', quantity: 1 }],
};
const order = (body: object) =>
  pipe.transform(body, { type: 'body', metatype: CreateManualOrderDto });

describe('Manual order input validation', () => {
  it.each(['customerName', 'customerPhone', 'shippingAddress'])(
    'rejects whitespace-only %s before reaching the service',
    async (field) => {
      await expect(
        order({ ...validOrder, [field]: ' \t\n ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each(['123', 'ZZZ', 'M1D', ' MAD '])(
    'rejects invalid ISO currency %s',
    async (currency) => {
      await expect(order({ ...validOrder, currency })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it.each(['MAD', 'mad', 'USD', 'eur'])(
    'accepts and normalizes valid currency %s',
    async (currency) => {
      await expect(order({ ...validOrder, currency })).resolves.toMatchObject({
        currency: currency.toUpperCase(),
      });
    },
  );

  it('preserves valid contact strings for existing idempotent request hashes', async () => {
    await expect(
      order({ ...validOrder, customerName: ' Test customer ' }),
    ).resolves.toMatchObject({ customerName: ' Test customer ' });
  });

  it.each([1e20, -1, 0.12345])(
    'rejects invalid shipping %s',
    async (shippingCost) => {
      await expect(
        order({ ...validOrder, shippingCost }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it.each([1e20, -1, 0.12345])(
    'rejects invalid unit price %s',
    async (unitPrice) => {
      await expect(
        order({
          ...validOrder,
          items: [{ ...validOrder.items[0], unitPrice }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('accepts zero and four-decimal money values', async () => {
    await expect(
      order({
        ...validOrder,
        shippingCost: 0,
        items: [{ ...validOrder.items[0], unitPrice: 12.3456 }],
      }),
    ).resolves.toMatchObject({ shippingCost: 0 });
  });
});

describe.each([EcommerceOrderQueryDto, EcommerceOrderExportQueryDto])(
  '%s strict query validation',
  (metatype) => {
    const query = (input: object) =>
      pipe.transform(input, { type: 'query', metatype });
    it.each([
      'includeCancelled',
      'includeRefunded',
      'includeDispatched',
      'includeInRevenue',
    ])('accepts exact true/false values for %s', async (field) => {
      await expect(query({ [field]: 'true' })).resolves.toMatchObject({
        [field]: true,
      });
      await expect(query({ [field]: 'false' })).resolves.toMatchObject({
        [field]: false,
      });
      for (const value of ['garbage', '1', '', ['false']]) {
        await expect(query({ [field]: value })).rejects.toBeInstanceOf(
          BadRequestException,
        );
      }
    });
  },
);

describe('Orders pagination', () => {
  it.each(['1junk', '1.5', '2e0', '', ['2'], 'Infinity', '9007199254740993'])(
    'rejects malformed integer %s',
    async (value) => {
      for (const field of ['page', 'limit']) {
        await expect(
          pipe.transform(
            { [field]: value },
            { type: 'query', metatype: EcommerceOrderQueryDto },
          ),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    },
  );

  it('accepts integer strings without changing defaults', async () => {
    await expect(
      pipe.transform(
        { page: '2', limit: '100' },
        { type: 'query', metatype: EcommerceOrderQueryDto },
      ),
    ).resolves.toMatchObject({ page: 2, limit: 100 });
  });
});
