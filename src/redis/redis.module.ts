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
        });

        try {
          await client.connect();
        } catch (error) {
          const redisRequired =
            configService.get<string>('REDIS_REQUIRED', 'false') === 'true';

          if (redisRequired) {
            throw error;
          }

          console.warn(
            'Redis connection failed; continuing because REDIS_REQUIRED is not true.',
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
