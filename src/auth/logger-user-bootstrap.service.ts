import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LoggerUserBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const phone = this.configService.get<string>('LOGGER_PHONE');
    const password = this.configService.get<string>('LOGGER_PASSWORD');

    if (!phone || !password) {
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.upsert({
      where: { phone },
      update: { passwordHash, isPhoneVerified: true },
      create: { phone, passwordHash, isPhoneVerified: true },
    });
  }
}
