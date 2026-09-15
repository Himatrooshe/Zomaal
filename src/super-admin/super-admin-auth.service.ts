import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import type { RedisClientType } from 'redis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { SuperAdminChangePasswordDto } from './dto/super-admin-change-password.dto';
import type { SuperAdminJwtTokenPayload } from './interfaces/super-admin-jwt-payload.interface';
import {
  ActivityEntity,
  ActivityLogService,
} from './activity/activity-log.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class SuperAdminAuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private activity: ActivityLogService,
    @Inject(REDIS_CLIENT) private redisClient: RedisClientType,
  ) {}

  async login(dto: SuperAdminLoginDto) {
    const { username, password } = dto;

    await this.assertRateLimit(
      `admin-auth:login:${username}`,
      5,
      15 * 60,
      'Too many login attempts. Please try again later.',
    );

    const admin = await this.prisma.superAdmin.findUnique({
      where: { username },
    });
    const passwordMatches =
      admin && (await bcrypt.compare(password, admin.passwordHash));

    if (!admin || !passwordMatches || !admin.isActive) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const tokens = await this.generateTokens(admin.id, admin.username);
    await this.updateRefreshToken(admin.id, tokens.refreshToken);
    await this.clearRateLimit(`admin-auth:login:${username}`);

    await this.prisma.superAdmin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });
    await this.activity.record(
      { adminId: admin.id, username: admin.username },
      {
        action: 'ADMIN_LOGIN',
        entityType: ActivityEntity.ADMIN,
        entityId: admin.id,
        summary: 'Signed in to the admin panel',
      },
    );

    return {
      ...tokens,
      admin: {
        id: admin.id,
        username: admin.username,
        lastLoginAt: new Date().toISOString(),
      },
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: SuperAdminJwtTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<SuperAdminJwtTokenPayload>(
        refreshToken,
        { secret: this.getJwtSecret() },
      );
    } catch {
      throw new UnauthorizedException('Access Denied');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Access Denied');
    }

    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
    });
    if (!admin || !admin.hashedRefreshToken || !admin.isActive) {
      throw new UnauthorizedException('Access Denied');
    }

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      admin.hashedRefreshToken,
    );
    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access Denied');
    }

    const tokens = await this.generateTokens(admin.id, admin.username);
    await this.updateRefreshToken(admin.id, tokens.refreshToken);

    return tokens;
  }

  async logout(adminId: string) {
    await this.prisma.superAdmin.update({
      where: { id: adminId },
      data: { hashedRefreshToken: null },
    });

    return { message: 'Logged out successfully' };
  }

  async me(adminId: string) {
    const admin = await this.prisma.superAdmin.findUniqueOrThrow({
      where: { id: adminId },
    });

    return {
      id: admin.id,
      username: admin.username,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    };
  }

  async changePassword(adminId: string, dto: SuperAdminChangePasswordDto) {
    const admin = await this.prisma.superAdmin.findUniqueOrThrow({
      where: { id: adminId },
    });

    const currentPasswordMatches = await bcrypt.compare(
      dto.currentPassword,
      admin.passwordHash,
    );
    if (!currentPasswordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // Rotating the password also revokes the current refresh token — the
    // super admin account has full system access, so a password change
    // must not leave an older session silently still refreshable.
    await this.prisma.superAdmin.update({
      where: { id: adminId },
      data: { passwordHash, hashedRefreshToken: null },
    });
    await this.activity.record(
      { adminId: admin.id, username: admin.username },
      {
        action: 'ADMIN_PASSWORD_CHANGED',
        entityType: ActivityEntity.ADMIN,
        entityId: admin.id,
        summary: 'Changed the super admin password',
      },
    );

    return { message: 'Password updated successfully' };
  }

  private async generateTokens(adminId: string, username: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          sub: adminId,
          username,
          type: 'access',
        } satisfies SuperAdminJwtTokenPayload,
        { secret: this.getJwtSecret(), expiresIn: '15m' },
      ),
      this.jwtService.signAsync(
        {
          sub: adminId,
          username,
          type: 'refresh',
        } satisfies SuperAdminJwtTokenPayload,
        { secret: this.getJwtSecret(), expiresIn: '7d' },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(adminId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.superAdmin.update({
      where: { id: adminId },
      data: { hashedRefreshToken },
    });
  }

  private getJwtSecret(): string {
    const secret =
      this.configService.get<string>('SUPER_ADMIN_JWT_SECRET') ||
      this.configService.get<string>('JWT_SECRET');

    if (!secret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }

    return secret;
  }

  private async assertRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
    message: string,
  ) {
    if (!this.redisClient.isOpen) {
      return;
    }

    const count = await this.redisClient.incr(key);

    if (count === 1) {
      await this.redisClient.expire(key, windowSeconds);
    }

    if (count > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private async clearRateLimit(key: string) {
    if (!this.redisClient.isOpen) {
      return;
    }
    await this.redisClient.del(key);
  }
}
