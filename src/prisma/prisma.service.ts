import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const configuredConnectionTimeout = Number(
      process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10000,
    );
    const connectionTimeoutMillis =
      Number.isFinite(configuredConnectionTimeout) &&
      configuredConnectionTimeout > 0
        ? configuredConnectionTimeout
        : 10000;
    const pool = new Pool({ connectionString, connectionTimeoutMillis });
    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
