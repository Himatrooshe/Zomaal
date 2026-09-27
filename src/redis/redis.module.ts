import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Cloud Run cheap deploys skip Memorystore. Any leftover localhost default
 * or YOUR_* placeholder must NOT trigger a connect attempt — that burned
 * ~76s of reconnect retries on cold start.
 */
export function isRedisConfigured(options: {
  redisUrl?: string | null;
  redisHost?: string | null;
}): boolean {
  const url = options.redisUrl?.trim() ?? '';
  const host = options.redisHost?.trim() ?? '';
  if (url && !isPlaceholderRedisValue(url)) return true;
  if (!host || isPlaceholderRedisValue(host)) return false;
  return true;
}

function isPlaceholderRedisValue(value: string): boolean {
  return /YOUR_REDIS|YOUR_|changeme|example\.com/i.test(value);
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: async (configService: ConfigService) => {
        const configuredHost = configService.get<string>('REDIS_HOST');
        const host = configuredHost?.trim() || 'localhost';
        const port = configService.get<number>('REDIS_PORT', 6379);
        const redisRequired =
          configService.get<string>('REDIS_REQUIRED', 'false') === 'true';
        const configuredConnectTimeout = Number(
          configService.get<string>('REDIS_CONNECT_TIMEOUT_MS', '5000'),
        );
        // Keep optional Redis from blocking Cloud Run cold starts for long.
        const connectTimeout =
          Number.isFinite(configuredConnectTimeout) &&
          configuredConnectTimeout > 0
            ? Math.min(configuredConnectTimeout, redisRequired ? 30_000 : 3_000)
            : redisRequired
              ? 5000
              : 3000;
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
          configuredHost &&
          (configuredHost.startsWith('redis://') ||
            configuredHost.startsWith('rediss://'))
        ) {
          redisUrl = configuredHost;
        }

        const redisConfigured = isRedisConfigured({
          redisUrl,
          redisHost: configuredHost,
        });

        // No Redis in this environment — return a disconnected client.
        // Call sites already guard on isOpen / isReady.
        if (!redisConfigured && !redisRequired) {
          console.warn(
            'Redis not configured (no REDIS_URL / REDIS_HOST); skipping connection for faster cold starts.',
          );
          return createClient({ url: `redis://${host}:${port}` });
        }

        const client = createClient({
          url: redisUrl || `redis://${host}:${port}`,
          socket: {
            connectTimeout,
            reconnectStrategy: createRedisReconnectStrategy(
              redisRequired ? reconnectMaxAttempts : Math.min(reconnectMaxAttempts, 3),
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
