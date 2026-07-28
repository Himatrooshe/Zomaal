import { createRedisReconnectStrategy } from './redis.module';

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
