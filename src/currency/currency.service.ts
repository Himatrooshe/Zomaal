import {
  Injectable,
  Logger,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  // Real rates from the last successful fetch, used while the provider is down.
  private readonly LAST_GOOD_KEY = 'zomaal:exchange_rates:USD:last-good';
  private readonly LAST_GOOD_TTL_SECONDS = 7 * 24 * 3600;
  private memoryCache: Record<string, number> | null = null;
  private memoryCacheExpiresAt = 0;
  private lastGood: Record<string, number> | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: RedisClientType) {}

  /**
   * Latest exchange rates relative to USD, cached in Redis for 12 hours.
   * Returns null when no real rates are available — never invented ones.
   */
  async getExchangeRates(): Promise<Record<string, number> | null> {
    if (this.memoryCache && Date.now() < this.memoryCacheExpiresAt) {
      return this.memoryCache;
    }

    const cached = await this.readCache(this.CACHE_KEY);
    if (cached) {
      this.remember(cached);
      return cached;
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

      if (this.redis.isReady) {
        const value = JSON.stringify(data.rates);
        await this.redis.set(this.CACHE_KEY, value, {
          EX: this.CACHE_TTL_SECONDS,
        });
        await this.redis.set(this.LAST_GOOD_KEY, value, {
          EX: this.LAST_GOOD_TTL_SECONDS,
        });
      }
      this.lastGood = data.rates;
      this.remember(data.rates);
      return data.rates;
    } catch (error) {
      this.logger.error('Error fetching exchange rates', error);
      const lastGood =
        (await this.readCache(this.LAST_GOOD_KEY)) ?? this.lastGood;
      if (lastGood) {
        this.logger.warn('Using the last successfully fetched exchange rates');
        this.remember(lastGood);
        return lastGood;
      }
      return null;
    }
  }

  /**
   * Converts using real rates only. Returns null when either currency has no
   * known rate, so callers can report the amount as unconverted.
   */
  async convertOrNull(
    amount: Prisma.Decimal | number | string,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<Prisma.Decimal | null> {
    const decimalAmount = new Prisma.Decimal(amount);
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    if (from === to) return decimalAmount;

    const rates = await this.getExchangeRates();
    const rateFrom = rates?.[from];
    const rateTo = rates?.[to];
    if (!rateFrom || !rateTo) {
      this.logger.warn(`No exchange rate available for ${from} → ${to}`);
      return null;
    }

    // Rates are relative to USD, so 1 `from` = rateTo / rateFrom `to`.
    return decimalAmount.times(
      new Prisma.Decimal(rateTo).dividedBy(new Prisma.Decimal(rateFrom)),
    );
  }

  /** Like convertOrNull, but throws 503 when no real rate is available. */
  async convertAmount(
    amount: Prisma.Decimal | number | string,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<Prisma.Decimal> {
    const converted = await this.convertOrNull(
      amount,
      fromCurrency,
      toCurrency,
    );
    if (!converted) {
      throw new ServiceUnavailableException(
        `Exchange rate ${fromCurrency.toUpperCase()} → ${toCurrency.toUpperCase()} is unavailable. Try again later.`,
      );
    }
    return converted;
  }

  private remember(rates: Record<string, number>): void {
    this.memoryCache = rates;
    this.memoryCacheExpiresAt = Date.now() + 60000;
  }

  private async readCache(key: string): Promise<Record<string, number> | null> {
    if (!this.redis.isReady) return null;
    const cached = await this.redis.get(key);
    if (!cached) return null;
    try {
      return JSON.parse(cached) as Record<string, number>;
    } catch (e) {
      this.logger.error('Failed to parse cached exchange rates', e);
      return null;
    }
  }
}
