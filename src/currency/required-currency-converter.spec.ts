import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { requiredCurrencyConverter } from './required-currency-converter';

describe('requiredCurrencyConverter', () => {
  it('uses one rate for repeated and concurrent amounts without rounding each amount', async () => {
    const currency = {
      convertOrNull: jest
        .fn()
        .mockResolvedValue(new Prisma.Decimal('0.33333333333333333333')),
    };
    const convert = requiredCurrencyConverter(currency);
    const values = await Promise.all(
      [1, 2].map((value) => convert(new Prisma.Decimal(value), 'mad', 'USD')),
    );
    expect(values[0].plus(values[1]).toFixed(2)).toBe('1.00');
    expect(currency.convertOrNull).toHaveBeenCalledTimes(1);
    expect(currency.convertOrNull).toHaveBeenCalledWith(1, 'MAD', 'USD');
  });

  it.each([
    null,
    new Prisma.Decimal(0),
    new Prisma.Decimal(-1),
    new Prisma.Decimal(NaN),
    new Prisma.Decimal(Infinity),
  ])('rejects unavailable or invalid rates (%s)', async (rate) => {
    const convert = requiredCurrencyConverter({
      convertOrNull: jest.fn().mockResolvedValue(rate),
    });
    await expect(
      convert(new Prisma.Decimal(10), 'USD', 'MAD'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('does not need a provider for same-currency or zero amounts', async () => {
    const convert = requiredCurrencyConverter();
    await expect(convert(new Prisma.Decimal(5), 'mad', 'MAD')).resolves.toEqual(
      new Prisma.Decimal(5),
    );
    await expect(convert(new Prisma.Decimal(0), 'USD', 'MAD')).resolves.toEqual(
      new Prisma.Decimal(0),
    );
  });

  it('rejects unknown currency metadata instead of guessing', async () => {
    await expect(
      requiredCurrencyConverter()(new Prisma.Decimal(10), '', 'MAD'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
