import {
  Injectable,
  Inject,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StaffStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import type { OtpProvider } from '../interfaces/otp-provider.interface';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { RedisClientType } from 'redis';
import type { JwtTokenPayload } from './interfaces/jwt-payload.interface';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/forgot-password.dto';
import { createHmac, randomUUID } from 'crypto';
import {
  hashRefreshToken,
  refreshTokenMatches,
} from './refresh-token-hash.util';

const BCRYPT_ROUNDS = 10;
const PASSWORD_RESET_TTL_SECONDS = 10 * 60;

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
    const { phone, channel = 'sms' } = sendOtpDto;

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

  async login(loginDto: LoginDto) {
    const { phone, password, rememberMe = false } = loginDto;

    await this.assertRateLimit(
      `auth:login:${phone}`,
      5,
      15 * 60,
      'Too many login attempts. Please try again later.',
    );

    const user = await this.prisma.user.findUnique({
      where: { phone },
      include: { staffMembership: true },
    });
    const passwordMatches =
      user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    // A deactivated staff member keeps their credentials (per the deactivate-
    // only removal policy) but cannot sign in at all — checked here, not just
    // at resource-access time, so the mobile app doesn't hand them a session
    // token it then rejects on the very next request.
    if (
      user.staffMembership &&
      user.staffMembership.status !== StaffStatus.ACTIVE
    ) {
      throw new UnauthorizedException(
        'This staff account has been deactivated',
      );
    }

    const tokens = await this.generateTokens(user.id, user.phone, rememberMe);
    await this.updateRefreshToken(user.id, tokens.refreshToken);
    await this.clearRateLimit(`auth:login:${phone}`);

    if (user.staffMembership) {
      await this.prisma.staffMember
        .update({
          where: { id: user.staffMembership.id },
          data: { lastLoginAt: new Date(), lastActiveAt: new Date() },
        })
        .catch(() => undefined);
    }

    return {
      ...tokens,
      isProfileCompleted: user.onboardingComplete,
    };
  }

  // Edit Profile's Phone Number field: phone is the login identifier and
  // must stay unique, so — unlike name/photo/address — it cannot just be
  // written directly. Request sends an OTP to the *new* number; confirm
  // verifies it before the swap actually happens, exactly like sign-up.
  async requestPhoneChange(userId: string, dto: SendOtpDto) {
    const { phone, channel = 'sms' } = dto;

    await this.assertRateLimit(
      `auth:phone-change:request:${userId}`,
      3,
      10 * 60,
      'Too many phone number change requests. Please try again later.',
    );

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (phone === user.phone) {
      throw new BadRequestException(
        'New phone number must be different from the current one',
      );
    }

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new ConflictException('Phone number already in use');
    }

    await this.otpProvider.sendOtp(phone, channel);

    return { message: 'OTP sent successfully' };
  }

  async confirmPhoneChange(userId: string, dto: VerifyOtpDto) {
    const { phone, otp } = dto;

    await this.assertRateLimit(
      `auth:phone-change:confirm:${userId}`,
      5,
      10 * 60,
      'Too many phone number change attempts. Please request a new OTP later.',
    );

    const isValid = await this.otpProvider.verifyOtp(phone, otp);
    if (!isValid) {
      throw new BadRequestException('Invalid or expired OTP');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Re-check uniqueness at commit time: another account could have taken
    // this number in the gap between request and confirm.
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Phone number already in use');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { phone, isPhoneVerified: true },
    });
    await this.clearRateLimit(`auth:phone-change:confirm:${userId}`);

    // The access/refresh tokens already issued carry the old phone in their
    // payload — reissue both so the client's session reflects the new one,
    // same "revoke and reissue" shape as every other identity-changing flow
    // here (this also invalidates the old refresh token, same one-session-
    // at-a-time model login/verify-otp already use).
    const tokens = await this.generateTokens(userId, phone);
    await this.updateRefreshToken(userId, tokens.refreshToken);

    return {
      ...tokens,
      isProfileCompleted: user.onboardingComplete,
    };
  }

  async logout(userId: string) {
    // Revoking the refresh token is what actually ends the session — the
    // access token already issued keeps working until its normal 15-minute
    // expiry, same tradeoff as changing the password. Idempotent: a token
    // for an already-deleted user still gets a clean 200 rather than a 500.
    await this.prisma.user.updateMany({
      where: { id: userId },
      data: { hashedRefreshToken: null },
    });

    return { message: 'Logged out successfully' };
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

    if (!refreshTokenMatches(refreshToken, user.hashedRefreshToken)) {
      throw new UnauthorizedException('Access Denied');
    }

    const tokens = await this.generateTokens(
      user.id,
      user.phone,
      payload.rm === true,
    );
    await this.updateRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  // Forgot password, step 1. The response is identical whether or not the
  // number has an account, so the endpoint can't be used to discover users;
  // an OTP is only actually sent (and paid for) when the account exists.
  async requestPasswordReset(phone: string) {
    await this.assertRateLimit(
      `auth:password-reset:request:${phone}`,
      3,
      10 * 60,
      'Too many password reset requests. Please try again later.',
    );

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (user) {
      try {
        await this.otpProvider.sendOtp(phone, 'sms');
      } catch (error) {
        // A 400 (blocked country, landline…) only happens for existing
        // accounts, so returning it would reveal the number is registered.
        if (!(error instanceof BadRequestException)) {
          throw error;
        }
      }
    }

    return {
      message: 'If an account exists for this number, an OTP has been sent',
    };
  }

  // Step 2: the OTP screen. Returns a short-lived reset token so the
  // "New password" screen can come after the code is confirmed.
  async verifyPasswordReset(dto: VerifyOtpDto) {
    const { phone, otp } = dto;

    await this.assertRateLimit(
      `auth:password-reset:verify:${phone}`,
      5,
      10 * 60,
      'Too many OTP verification attempts. Please request a new OTP later.',
    );

    const user = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true, phone: true, passwordHash: true },
    });
    if (!user || !(await this.otpProvider.verifyOtp(phone, otp))) {
      throw new BadRequestException('Invalid or expired OTP');
    }
    await this.clearRateLimit(`auth:password-reset:verify:${phone}`);

    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_SECONDS * 1000);
    const resetToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        phone: user.phone,
        type: 'password_reset',
        pwv: this.passwordFingerprint(user.passwordHash),
      } satisfies JwtTokenPayload,
      {
        secret: this.getJwtSecret(),
        expiresIn: PASSWORD_RESET_TTL_SECONDS,
      },
    );

    return { resetToken, expiresAt: expiresAt.toISOString() };
  }

  // Step 3. The token carries a fingerprint of the password it was issued
  // against, so once the password changes the token (and any sibling token
  // from the same OTP) stops working — single use without server state.
  async resetPassword(dto: ResetPasswordDto) {
    let payload: JwtTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtTokenPayload>(
        dto.resetToken,
        { secret: this.getJwtSecret() },
      );
    } catch {
      throw new UnauthorizedException('Reset link is invalid or has expired');
    }
    if (payload.type !== 'password_reset' || !payload.pwv) {
      throw new UnauthorizedException('Reset link is invalid or has expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, passwordHash: true },
    });
    if (!user || this.passwordFingerprint(user.passwordHash) !== payload.pwv) {
      throw new UnauthorizedException('Reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    // Signs out every device: a reset usually means the old password leaked.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, hashedRefreshToken: null, isPhoneVerified: true },
    });

    return { message: 'Password reset successfully' };
  }

  private passwordFingerprint(passwordHash: string | null): string {
    return createHmac('sha256', this.getJwtSecret())
      .update(passwordHash ?? '')
      .digest('base64url')
      .slice(0, 22);
  }

  private async generateTokens(
    userId: string,
    phone: string,
    rememberMe = false,
  ) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { sub: userId, phone, type: 'access' } satisfies JwtTokenPayload,
        {
          secret: this.getJwtSecret(),
          expiresIn: '15m',
        },
      ),
      this.jwtService.signAsync(
        {
          sub: userId,
          phone,
          type: 'refresh',
          ...(rememberMe && { rm: true }),
        } satisfies JwtTokenPayload,
        {
          secret: this.getJwtSecret(),
          expiresIn: rememberMe ? '30d' : '7d',
          jwtid: randomUUID(),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: hashRefreshToken(refreshToken) },
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
