import { ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from './currency.service';

const RATES = { USD: 1, MAD: 10, EUR: 0.5 };

function build(redisValues: Record<string, string> = {}, ready = true) {
  const store = { ...redisValues };
  const redis = {
    isReady: ready,
    get: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    set: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve('OK');
    }),
  };
  return { service: new CurrencyService(redis as never), redis, store };
}

function mockFetch(response: unknown, ok = true) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok,
    statusText: ok ? 'OK' : 'Bad Gateway',
    json: () => Promise.resolve(response),
  } as Response);
}

describe('CurrencyService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('converts through USD-based rates', async () => {
    mockFetch({ result: 'success', rates: RATES });
    const { service } = build();
    const value = await service.convertOrNull('20', 'EUR', 'MAD');
    expect(value?.toFixed(2)).toBe('400.00');
  });

  it('returns the same amount for the same currency without fetching', async () => {
    const fetchSpy = mockFetch({ result: 'success', rates: RATES });
    const { service } = build();
    const value = await service.convertOrNull(
      new Prisma.Decimal('5'),
      'mad',
      'MAD',
    );
    expect(value?.toFixed(2)).toBe('5.00');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stores the fetched rates as the last good copy', async () => {
    mockFetch({ result: 'success', rates: RATES });
    const { service, store } = build();
    await service.convertOrNull('1', 'USD', 'MAD');
    expect(JSON.parse(store['zomaal:exchange_rates:USD:last-good'])).toEqual(
      RATES,
    );
  });

  it('falls back to the last good rates when the provider fails', async () => {
    mockFetch({}, false);
    const { service } = build({
      'zomaal:exchange_rates:USD:last-good': JSON.stringify(RATES),
    });
    const value = await service.convertOrNull('3', 'USD', 'MAD');
    expect(value?.toFixed(2)).toBe('30.00');
  });

  it('returns null rather than inventing a rate when none is known', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const { service } = build({}, false);
    await expect(service.convertOrNull('3', 'USD', 'MAD')).resolves.toBeNull();
  });

  it('returns null for a currency the provider does not list', async () => {
    mockFetch({ result: 'success', rates: RATES });
    const { service } = build();
    await expect(service.convertOrNull('3', 'XYZ', 'MAD')).resolves.toBeNull();
  });

  it('convertAmount throws 503 when no rate is available', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const { service } = build({}, false);
    await expect(service.convertAmount('3', 'USD', 'MAD')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
