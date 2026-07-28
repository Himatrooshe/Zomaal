import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST', 'localhost');
        const port = configService.get<number>('REDIS_PORT', 6379);
        const configuredConnectTimeout = Number(
          configService.get<string>('REDIS_CONNECT_TIMEOUT_MS', '5000'),
        );
        const connectTimeout =
          Number.isFinite(configuredConnectTimeout) &&
          configuredConnectTimeout > 0
            ? configuredConnectTimeout
            : 5000;
        const reconnectMaxAttempts = positiveInteger(
          configService.get<string>('REDIS_RECONNECT_MAX_ATTEMPTS', '20'),
          20,
        );
        const reconnectMaxDelayMs = positiveInteger(
          configService.get<string>('REDIS_RECONNECT_MAX_DELAY_MS', '5000'),
          5000,
        );
        let redisUrl = configService.get<string>('REDIS_URL');

        // If REDIS_HOST accidentally contains the full URL (common when pasting cloud URLs)
        if (
          !redisUrl &&
          (host.startsWith('redis://') || host.startsWith('rediss://'))
        ) {
          redisUrl = host;
        }

        const client = createClient({
          url: redisUrl || `redis://${host}:${port}`,
          socket: {
            connectTimeout,
            reconnectStrategy: createRedisReconnectStrategy(
              reconnectMaxAttempts,
              reconnectMaxDelayMs,
            ),
          },
        });

        client.on('error', (error: unknown) => {
          if (client.isReady) {
            console.error(
              `Redis client error: ${error instanceof Error ? error.message : 'unknown error'}`,
            );
          }
        });

        try {
          await client.connect();
        } catch (error) {
          if (client.isOpen) {
            client.destroy();
          }

          const redisRequired =
            configService.get<string>('REDIS_REQUIRED', 'false') === 'true';

          if (redisRequired) {
            throw error;
          }

          console.warn(
            `Redis connection failed (${error instanceof Error ? error.message : 'unknown error'}); continuing because REDIS_REQUIRED is not true.`,
          );
        }

        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}

export function createRedisReconnectStrategy(
  maxAttempts: number,
  maxDelayMs: number,
): (retries: number) => number | Error {
  return (retries: number) => {
    if (retries >= maxAttempts) {
      return new Error(
        `Redis reconnect attempts exhausted after ${maxAttempts} attempts`,
      );
    }

    return Math.min(100 * 2 ** Math.min(retries, 10), maxDelayMs);
  };
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
