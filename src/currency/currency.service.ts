import { Injectable, Logger, Inject } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { RedisClientType } from 'redis';

interface ExchangeRateResponse {
  result: string;
  provider: string;
  documentation: string;
  terms_of_use: string;
  time_last_update_unix: number;
  time_last_update_utc: string;
  time_next_update_unix: number;
  time_next_update_utc: string;
  time_eol_unix: number;
  base_code: string;
  rates: Record<string, number>;
}

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);
  private readonly API_URL = 'https://open.er-api.com/v6/latest/USD';
  private readonly CACHE_KEY = 'zomaal:exchange_rates:USD';
  private readonly CACHE_TTL_SECONDS = 43200; // 12 hours
  private memoryCache: Record<string, number> | null = null;
  private memoryCacheExpiresAt = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  /**
   * Fetches latest exchange rates relative to USD.
   * Rates are cached in Redis for 12 hours to avoid rate limits.
   */
  async getExchangeRates(): Promise<Record<string, number>> {
    if (this.memoryCache && Date.now() < this.memoryCacheExpiresAt) {
      return this.memoryCache;
    }

    if (this.redis.isReady) {
      const cached = await this.redis.get(this.CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          this.memoryCache = parsed;
          this.memoryCacheExpiresAt = Date.now() + 60000;
          return parsed;
        } catch (e) {
          this.logger.error('Failed to parse cached exchange rates', e);
        }
      }
    }

    try {
      this.logger.log(`Fetching latest exchange rates from ${this.API_URL}`);
      const response = await fetch(this.API_URL);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch exchange rates: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as ExchangeRateResponse;
      if (data.result !== 'success' || !data.rates) {
        throw new Error('Invalid response format from exchange rate API');
      }

      // Save to redis
      if (this.redis.isReady) {
        await this.redis.set(this.CACHE_KEY, JSON.stringify(data.rates), {
          EX: this.CACHE_TTL_SECONDS,
        });
      }

      this.memoryCache = data.rates;
      this.memoryCacheExpiresAt = Date.now() + 60000;

      return data.rates;
    } catch (error) {
      this.logger.error('Error fetching exchange rates', error);
      // Return a safe fallback if fetch fails so the dashboard doesn't crash completely.
      return {
        USD: 1,
        MAD: 10,
        AED: 3.67,
        EUR: 0.9,
      };
    }
  }

  /**
   * Converts an amount from one currency to another using the latest exchange rates.
   * Uses Prisma.Decimal to prevent floating point inaccuracies.
   */
  async convertAmount(
    amount: Prisma.Decimal | number | string,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<Prisma.Decimal> {
    const decimalAmount = new Prisma.Decimal(amount);
    fromCurrency = fromCurrency.toUpperCase();
    toCurrency = toCurrency.toUpperCase();

    if (fromCurrency === toCurrency) {
      return decimalAmount;
    }

    const rates = await this.getExchangeRates();

    const rateFrom = rates[fromCurrency];
    const rateTo = rates[toCurrency];

    if (!rateFrom || !rateTo) {
      this.logger.warn(
        `Missing exchange rate for ${fromCurrency} or ${toCurrency}. Defaulting to 1:1`,
      );
      return decimalAmount;
    }

    // Since rates are relative to USD:
    // 1 USD = rateFrom 'fromCurrency'
    // 1 USD = rateTo 'toCurrency'
    // Therefore, 1 'fromCurrency' = rateTo / rateFrom 'toCurrency'
    const conversionRate = new Prisma.Decimal(rateTo).dividedBy(
      new Prisma.Decimal(rateFrom),
    );

    return decimalAmount.times(conversionRate);
  }
}
