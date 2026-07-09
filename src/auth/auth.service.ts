import {
  Injectable,
  Inject,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { OtpProvider } from '../interfaces/otp-provider.interface';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { RedisClientType } from 'redis';
import type { JwtTokenPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @Inject('OtpProvider') private otpProvider: OtpProvider,
    @Inject(REDIS_CLIENT) private redisClient: RedisClientType,
  ) {}

  async sendOtp(sendOtpDto: SendOtpDto) {
    const { phone, channel } = sendOtpDto;

    await this.assertRateLimit(
      `auth:otp:send:${channel}:${phone}`,
      3,
      10 * 60,
      'Too many OTP requests. Please try again later.',
    );

    // Call Twilio provider
    await this.otpProvider.sendOtp(phone, channel);

    return { message: 'OTP sent successfully' };
  }

  async verifyOtp(verifyOtpDto: VerifyOtpDto) {
    const { phone, otp } = verifyOtpDto;

    await this.assertRateLimit(
      `auth:otp:verify:${phone}`,
      5,
      10 * 60,
      'Too many OTP verification attempts. Please request a new OTP later.',
    );

    const isValid = await this.otpProvider.verifyOtp(phone, otp);

    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    // Find or create user
    let user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone,
          isPhoneVerified: true,
        },
      });
    }

    const tokens = await this.generateTokens(user.id, user.phone);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    await this.clearRateLimit(`auth:otp:verify:${phone}`);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      isProfileCompleted: user.onboardingComplete,
    };
  }

  async refreshTokens(refreshToken: string) {
    let payload: JwtTokenPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtTokenPayload>(
        refreshToken,
        {
          secret: this.getJwtSecret(),
        },
      );
    } catch {
      throw new UnauthorizedException('Access Denied');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Access Denied');
    }

    const userId = payload.sub;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.hashedRefreshToken) {
      throw new UnauthorizedException('Access Denied');
    }

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      user.hashedRefreshToken,
    );
    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access Denied');
    }

    const tokens = await this.generateTokens(user.id, user.phone);
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  private async generateTokens(userId: string, phone: string) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, phone, type: 'access' } satisfies JwtTokenPayload,
        {
          secret: this.getJwtSecret(),
          expiresIn: '15m',
        },
      ),
      this.jwtService.signAsync(
        { sub: userId, phone, type: 'refresh' } satisfies JwtTokenPayload,
        {
          secret: this.getJwtSecret(),
          expiresIn: '7d',
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken },
    });
  }

  private getJwtSecret(): string {
    const jwtSecret = this.configService.get<string>('JWT_SECRET');

    if (!jwtSecret) {
      throw new UnauthorizedException('JWT secret is not configured');
    }

    return jwtSecret;
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
