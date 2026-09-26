import {
  createRedisReconnectStrategy,
  isRedisConfigured,
} from './redis.module';

describe('createRedisReconnectStrategy', () => {
  it('uses bounded exponential backoff', () => {
    const reconnect = createRedisReconnectStrategy(5, 500);

    expect(reconnect(0)).toBe(100);
    expect(reconnect(1)).toBe(200);
    expect(reconnect(2)).toBe(400);
    expect(reconnect(3)).toBe(500);
  });

  it('stops after the configured number of attempts', () => {
    const reconnect = createRedisReconnectStrategy(3, 5000);

    expect(reconnect(3)).toBeInstanceOf(Error);
  });
});

describe('isRedisConfigured', () => {
  it('skips empty and YOUR_* placeholders so Cloud Run does not dial Redis', () => {
    expect(isRedisConfigured({})).toBe(false);
    expect(isRedisConfigured({ redisHost: '' })).toBe(false);
    expect(
      isRedisConfigured({ redisHost: 'YOUR_REDIS_HOST' }),
    ).toBe(false);
    expect(
      isRedisConfigured({
        redisUrl: 'redis://:YOUR_REDIS_AUTH@YOUR_REDIS_HOST:6379',
      }),
    ).toBe(false);
  });

  it('accepts real hosts and URLs including local Docker Redis', () => {
    expect(isRedisConfigured({ redisHost: 'localhost' })).toBe(true);
    expect(isRedisConfigured({ redisHost: '10.0.0.5' })).toBe(true);
    expect(
      isRedisConfigured({
        redisUrl: 'rediss://:secret@redis.example.internal:6379',
      }),
    ).toBe(true);
  });
});
