import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { JwtTokenPayload } from './interfaces/jwt-payload.interface';
import { hashRefreshToken } from './refresh-token-hash.util';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Issues a merchant/staff access + refresh token pair and stores the refresh
 * token hash, which revokes any refresh token issued before it (one active
 * session per account).
 */
@Injectable()
export class AuthTokensService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async issue(
    userId: string,
    phone: string,
    rememberMe = false,
  ): Promise<TokenPair> {
    const secret = this.getJwtSecret();
    const rm = rememberMe ? { rm: true } : {};

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, phone, type: 'access', ...rm } satisfies JwtTokenPayload,
        { secret, expiresIn: '15m' },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          phone,
          type: 'refresh',
          ...rm,
        } satisfies JwtTokenPayload,
        {
          secret,
          expiresIn: rememberMe ? '30d' : '7d',
          jwtid: randomUUID(),
        },
      ),
    ]);

    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: hashRefreshToken(refreshToken) },
    });

    return { accessToken, refreshToken };
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    if (!jwtSecret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }
    return jwtSecret;
  }
}
