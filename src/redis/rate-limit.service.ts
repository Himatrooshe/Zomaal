import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { RedisClientType } from 'redis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from './redis.constants';

// Expired Postgres buckets are swept on roughly 1 in this many hits.
const CLEANUP_EVERY = 100;

/**
 * Fixed-window counters for abuse-sensitive endpoints (OTP sends, logins).
 * Uses Redis when it is connected, and an atomic Postgres upsert otherwise,
 * so limits never silently switch off when Redis is absent.
 */
@Injectable()
export class RateLimitService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: RedisClientType,
  ) {}

  async assert(
    key: string,
    limit: number,
    windowSeconds: number,
    message: string,
  ): Promise<void> {
    const count = this.redis.isReady
      ? await this.hitRedis(key, windowSeconds)
      : await this.hitDatabase(key, windowSeconds);

    if (count > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async clear(key: string): Promise<void> {
    if (this.redis.isReady) {
      await this.redis.del(key);
      return;
    }
    await this.prisma.rateLimitBucket.deleteMany({ where: { key } });
  }

  private async hitRedis(key: string, windowSeconds: number) {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    return count;
  }

  private async hitDatabase(key: string, windowSeconds: number) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + windowSeconds * 1000);

    const rows = await this.prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt")
      VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now}
          THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now}
          THEN EXCLUDED."expiresAt" ELSE "RateLimitBucket"."expiresAt" END
      RETURNING "count"`;

    if (Math.random() * CLEANUP_EVERY < 1) {
      await this.prisma.rateLimitBucket
        .deleteMany({ where: { expiresAt: { lte: now } } })
        .catch(() => undefined);
    }

    return Number(rows[0]?.count ?? 0);
  }
}
