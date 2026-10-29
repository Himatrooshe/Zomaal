import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CurrencyService } from './currency.service';

/** A response/operation-local rate cache. Never substitute 1 for a missing rate. */
export function requiredCurrencyConverter(
  currency?: Pick<CurrencyService, 'convertOrNull'>,
) {
  const rates = new Map<string, Promise<Prisma.Decimal>>();
  return async (
    amount: Prisma.Decimal,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<Prisma.Decimal> => {
    const from = fromCurrency?.trim().toUpperCase();
    const to = toCurrency?.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from ?? '') || !/^[A-Z]{3}$/.test(to ?? '')) {
      throw new ServiceUnavailableException(
        'A valid source and target currency are required',
      );
    }
    if (!amount.isFinite()) {
      throw new ServiceUnavailableException(
        'A finite monetary amount is required',
      );
    }
    if (from === to || amount.isZero()) return amount;
    const key = `${from}:${to}`;
    let rate = rates.get(key);
    if (!rate) {
      rate = (async () => {
        const value = await currency?.convertOrNull(1, from, to);
        if (!value || !value.isFinite() || value.lte(0)) {
          throw new ServiceUnavailableException(
            `Exchange rate ${from} → ${to} is unavailable. Try again later.`,
          );
        }
        return value;
      })();
      rates.set(key, rate);
    }
    return amount.times(await rate);
  };
}

export type RequiredCurrencyConverter = ReturnType<
  typeof requiredCurrencyConverter
>;
