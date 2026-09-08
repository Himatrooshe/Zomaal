import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuthService } from './auth.service';

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
