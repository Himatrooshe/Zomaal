import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

const BCRYPT_ROUNDS = 12;

// Creates the single platform-level SuperAdmin row from
// SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD the first time the app boots.
//
// The env password is only a *seed*: once the account exists, the admin
// owns their password via Settings > Change Password, and a restart must
// not silently revert it to the env value (it used to — every boot re-wrote
// the hash). To recover a lost password, set SUPERADMIN_PASSWORD_RESET=true
// for one boot: that re-applies SUPERADMIN_PASSWORD and revokes sessions.
@Injectable()
export class SuperAdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminBootstrapService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const username = this.configService.get<string>('SUPERADMIN_USERNAME');
    const password = this.configService.get<string>('SUPERADMIN_PASSWORD');
    const forceReset =
      this.configService.get<string>('SUPERADMIN_PASSWORD_RESET') === 'true';

    if (!username || !password) {
      this.logger.warn(
        'SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD not configured — the Zomaal admin panel has no super admin account yet.',
      );
      return;
    }

    const existing = await this.prisma.superAdmin.findUnique({
      where: { username },
      select: { id: true },
    });

    if (!existing) {
      await this.prisma.superAdmin.create({
        data: {
          username,
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
          isActive: true,
        },
      });
      this.logger.log(`Created super admin account "${username}"`);
      return;
    }

    if (forceReset) {
      await this.prisma.superAdmin.update({
        where: { id: existing.id },
        data: {
          passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
          hashedRefreshToken: null,
          isActive: true,
        },
      });
      this.logger.warn(
        `SUPERADMIN_PASSWORD_RESET=true — reset the password for "${username}" to SUPERADMIN_PASSWORD. Remove the flag now.`,
      );
    }
  }
}
