import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

function build(redisReady: boolean) {
  const prisma = {
    $queryRaw: jest.fn(),
    rateLimitBucket: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  const redis = {
    isReady: redisReady,
    incr: jest.fn(),
    expire: jest.fn(),
    del: jest.fn(),
  };
  const service = new RateLimitService(prisma as never, redis as never);
  return { service, prisma, redis };
}

async function expect429(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

describe('RateLimitService with Redis', () => {
  it('sets the window expiry on the first hit only', async () => {
    const { service, redis, prisma } = build(true);
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await service.assert('k', 3, 60, 'slow down');
    await service.assert('k', 3, 60, 'slow down');

    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledWith('k', 60);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('throws 429 once the limit is exceeded', async () => {
    const { service, redis } = build(true);
    redis.incr.mockResolvedValue(4);

    await expect429(service.assert('k', 3, 60, 'slow down'));
  });

  it('clears the Redis key', async () => {
    const { service, redis, prisma } = build(true);

    await service.clear('k');

    expect(redis.del).toHaveBeenCalledWith('k');
    expect(prisma.rateLimitBucket.deleteMany).not.toHaveBeenCalled();
  });
});

describe('RateLimitService without Redis', () => {
  it('counts in Postgres instead of skipping the limit', async () => {
    const { service, prisma, redis } = build(false);
    prisma.$queryRaw.mockResolvedValue([{ count: 2 }]);

    await service.assert('k', 3, 60, 'slow down');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('throws 429 once the Postgres count exceeds the limit', async () => {
    const { service, prisma } = build(false);
    prisma.$queryRaw.mockResolvedValue([{ count: 4 }]);

    await expect429(service.assert('k', 3, 60, 'slow down'));
  });

  it('deletes the Postgres bucket on clear', async () => {
    const { service, prisma, redis } = build(false);

    await service.clear('k');

    expect(prisma.rateLimitBucket.deleteMany).toHaveBeenCalledWith({
      where: { key: 'k' },
    });
    expect(redis.del).not.toHaveBeenCalled();
  });
});
