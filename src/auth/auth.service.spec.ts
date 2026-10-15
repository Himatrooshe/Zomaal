import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { hashRefreshToken } from './refresh-token-hash.util';

type PrismaStub = {
  user: {
    updateMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
};

function build() {
  const prisma: PrismaStub = {
    user: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const jwtService = { signAsync: jest.fn().mockResolvedValue('signed-token') };
  const configService = { get: jest.fn().mockReturnValue('test-secret') };
  const otpProvider = { sendOtp: jest.fn(), verifyOtp: jest.fn() };
  const redisClient = { isOpen: false };

  const service = new AuthService(
    prisma as never,
    jwtService as never,
    configService as never,
    otpProvider,
    redisClient as never,
  );

  return { service, prisma, jwtService, configService, otpProvider };
}

// Real JWT signing, for flows that round-trip a token through the service.
function buildWithRealJwt() {
  const prisma: PrismaStub = {
    user: {
      updateMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const jwtService = new JwtService();
  const configService = { get: jest.fn().mockReturnValue('test-secret') };
  const otpProvider = { sendOtp: jest.fn(), verifyOtp: jest.fn() };
  const service = new AuthService(
    prisma as never,
    jwtService,
    configService as never,
    otpProvider,
    { isOpen: false } as never,
  );
  return { service, prisma, jwtService, otpProvider };
}

const SYNTHETIC_PHONE = '+212612345678';

describe('AuthService.sendOtp', () => {
  it('defaults to SMS when no channel is given', async () => {
    const { service, otpProvider } = build();

    await service.sendOtp({ phone: SYNTHETIC_PHONE });

    expect(otpProvider.sendOtp).toHaveBeenCalledWith(SYNTHETIC_PHONE, 'sms');
  });
});

describe('AuthService.login rememberMe', () => {
  async function loginWith(rememberMe?: boolean) {
    const { service, prisma, jwtService } = buildWithRealJwt();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: SYNTHETIC_PHONE,
      passwordHash: await bcrypt.hash('Password123', 4),
      onboardingComplete: true,
      staffMembership: null,
    });
    const result = await service.login({
      phone: SYNTHETIC_PHONE,
      password: 'Password123',
      rememberMe,
    });
    const payload = jwtService.decode<{
      exp: number;
      iat: number;
      rm?: boolean;
    }>(result.refreshToken);
    return { service, prisma, payload, result };
  }

  it('issues a 7-day refresh token by default', async () => {
    const { payload } = await loginWith();
    expect(payload.exp - payload.iat).toBe(7 * 24 * 3600);
    expect(payload.rm).toBeUndefined();
  });

  it('issues a 30-day refresh token with rememberMe and keeps it on refresh', async () => {
    const { service, prisma, payload, result } = await loginWith(true);
    expect(payload.exp - payload.iat).toBe(30 * 24 * 3600);

    const storedHash = hashRefreshToken(result.refreshToken);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: SYNTHETIC_PHONE,
      hashedRefreshToken: storedHash,
    });
    const rotated = await service.refreshTokens(result.refreshToken);
    const rotatedPayload = new JwtService().decode<{
      exp: number;
      iat: number;
      rm?: boolean;
    }>(rotated.refreshToken);
    expect(rotatedPayload.exp - rotatedPayload.iat).toBe(30 * 24 * 3600);
    expect(rotatedPayload.rm).toBe(true);
  });
});

describe('AuthService.refreshTokens rotation', () => {
  it('rejects a refresh token once it has been rotated', async () => {
    const { service, prisma } = buildWithRealJwt();
    const user = {
      id: 'user-1',
      phone: SYNTHETIC_PHONE,
      passwordHash: await bcrypt.hash('Password123', 4),
      onboardingComplete: true,
      staffMembership: null,
      hashedRefreshToken: null as string | null,
    };
    prisma.user.findUnique.mockImplementation(() => Promise.resolve(user));
    prisma.user.update.mockImplementation(
      (args: { data: { hashedRefreshToken?: string } }) => {
        if (args.data.hashedRefreshToken !== undefined) {
          user.hashedRefreshToken = args.data.hashedRefreshToken;
        }
        return Promise.resolve(user);
      },
    );

    const { refreshToken: first } = await service.login({
      phone: SYNTHETIC_PHONE,
      password: 'Password123',
    });
    const { refreshToken: second } = await service.refreshTokens(first);

    expect(second).not.toBe(first);
    await expect(service.refreshTokens(first)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.refreshTokens(second)).resolves.toBeDefined();
  });
});

describe('AuthService forgot password', () => {
  it('sends an OTP only when the account exists, with the same response either way', async () => {
    const { service, prisma, otpProvider } = build();

    prisma.user.findUnique.mockResolvedValueOnce(null);
    const missing = await service.requestPasswordReset(SYNTHETIC_PHONE);
    expect(otpProvider.sendOtp).not.toHaveBeenCalled();

    prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1' });
    const existing = await service.requestPasswordReset(SYNTHETIC_PHONE);
    expect(otpProvider.sendOtp).toHaveBeenCalledWith(SYNTHETIC_PHONE, 'sms');

    expect(missing).toEqual(existing);
  });

  it('does not reveal an existing account when the SMS is rejected', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    otpProvider.sendOtp.mockRejectedValue(
      new BadRequestException(
        'SMS verification is not available for this country',
      ),
    );

    await expect(
      service.requestPasswordReset(SYNTHETIC_PHONE),
    ).resolves.toEqual({
      message: 'If an account exists for this number, an OTP has been sent',
    });
  });

  it('rejects verification for an unknown number without calling the OTP provider', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.verifyPasswordReset({ phone: SYNTHETIC_PHONE, otp: '123456' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(otpProvider.verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects a wrong OTP', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: SYNTHETIC_PHONE,
      passwordHash: null,
    });
    otpProvider.verifyOtp.mockResolvedValue(false);

    await expect(
      service.verifyPasswordReset({ phone: SYNTHETIC_PHONE, otp: '000000' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resets the password once, signs out all devices, and refuses token reuse', async () => {
    const { service, prisma, otpProvider } = buildWithRealJwt();
    const user = {
      id: 'user-1',
      phone: SYNTHETIC_PHONE,
      passwordHash: 'old-hash' as string | null,
    };
    prisma.user.findUnique.mockImplementation(() => Promise.resolve(user));
    otpProvider.verifyOtp.mockResolvedValue(true);

    const { resetToken } = await service.verifyPasswordReset({
      phone: SYNTHETIC_PHONE,
      otp: '123456',
    });

    await expect(
      service.resetPassword({ resetToken, newPassword: 'NewPass123' }),
    ).resolves.toEqual({ message: 'Password reset successfully' });

    const update = (
      prisma.user.update.mock.calls as [
        {
          where: { id: string };
          data: { passwordHash: string; hashedRefreshToken: null };
        },
      ][]
    )[0][0];
    expect(update.where).toEqual({ id: 'user-1' });
    expect(update.data.hashedRefreshToken).toBeNull();
    expect(await bcrypt.compare('NewPass123', update.data.passwordHash)).toBe(
      true,
    );

    user.passwordHash = update.data.passwordHash;
    await expect(
      service.resetPassword({ resetToken, newPassword: 'Another123' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses an access token used as a reset token', async () => {
    const { service, jwtService } = buildWithRealJwt();
    const accessToken = await jwtService.signAsync(
      { sub: 'user-1', phone: SYNTHETIC_PHONE, type: 'access' },
      { secret: 'test-secret' },
    );

    await expect(
      service.resetPassword({
        resetToken: accessToken,
        newPassword: 'NewPass123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AuthService.logout', () => {
  it('revokes the refresh token for the current user', async () => {
    const { service, prisma } = build();
    prisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.logout('user-1');

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { hashedRefreshToken: null },
    });
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('is idempotent for a user that no longer exists', async () => {
    const { service, prisma } = build();
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.logout('missing')).resolves.toEqual({
      message: 'Logged out successfully',
    });
  });
});

describe('AuthService.requestPhoneChange', () => {
  it('throws NotFoundException when the user no longer exists', async () => {
    const { service, prisma } = build();
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.requestPhoneChange('missing', {
        phone: '+212612345678',
        channel: 'sms',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a new phone number identical to the current one', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: '+212612345678',
    });

    await expect(
      service.requestPhoneChange('user-1', {
        phone: '+212612345678',
        channel: 'sms',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(otpProvider.sendOtp).not.toHaveBeenCalled();
  });

  it('rejects a phone number already used by another account', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', phone: '+212600000001' })
      .mockResolvedValueOnce({ id: 'user-2', phone: '+212612345678' });

    await expect(
      service.requestPhoneChange('user-1', {
        phone: '+212612345678',
        channel: 'sms',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(otpProvider.sendOtp).not.toHaveBeenCalled();
  });

  it('sends an OTP to the new phone number', async () => {
    const { service, prisma, otpProvider } = build();
    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-1', phone: '+212600000001' })
      .mockResolvedValueOnce(null);

    const result = await service.requestPhoneChange('user-1', {
      phone: '+212612345678',
      channel: 'sms',
    });

    expect(otpProvider.sendOtp).toHaveBeenCalledWith('+212612345678', 'sms');
    expect(result).toEqual({ message: 'OTP sent successfully' });
  });
});

describe('AuthService.confirmPhoneChange', () => {
  it('rejects an invalid or expired OTP', async () => {
    const { service, otpProvider, prisma } = build();
    otpProvider.verifyOtp.mockResolvedValue(false);

    await expect(
      service.confirmPhoneChange('user-1', {
        phone: '+212612345678',
        otp: '123456',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when the user no longer exists', async () => {
    const { service, otpProvider, prisma } = build();
    otpProvider.verifyOtp.mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.confirmPhoneChange('missing', {
        phone: '+212612345678',
        otp: '123456',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects when the number was claimed by another account in the meantime', async () => {
    const { service, otpProvider, prisma } = build();
    otpProvider.verifyOtp.mockResolvedValue(true);
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        phone: '+212600000001',
        onboardingComplete: true,
      })
      .mockResolvedValueOnce({ id: 'user-2', phone: '+212612345678' });

    await expect(
      service.confirmPhoneChange('user-1', {
        phone: '+212612345678',
        otp: '123456',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('updates the phone number and reissues tokens on success', async () => {
    const { service, otpProvider, prisma, jwtService } = build();
    otpProvider.verifyOtp.mockResolvedValue(true);
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'user-1',
        phone: '+212600000001',
        onboardingComplete: true,
      })
      .mockResolvedValueOnce(null);
    prisma.user.update.mockResolvedValue({});

    const result = await service.confirmPhoneChange('user-1', {
      phone: '+212612345678',
      otp: '123456',
    });

    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-1' },
      data: { phone: '+212612345678', isPhoneVerified: true },
    });
    expect(jwtService.signAsync).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      accessToken: 'signed-token',
      refreshToken: 'signed-token',
      isProfileCompleted: true,
    });
  });
});
