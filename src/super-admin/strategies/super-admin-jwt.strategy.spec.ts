import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import {
  SUPER_ADMIN_TOKEN_SCOPE,
  type SuperAdminJwtTokenPayload,
} from '../interfaces/super-admin-jwt-payload.interface';
import { SuperAdminJwtStrategy } from './super-admin-jwt.strategy';

function build(admin: { isActive: boolean } | null) {
  const findUnique = jest
    .fn()
    .mockResolvedValue(
      admin && { id: 'admin-1', username: 'root', isActive: admin.isActive },
    );
  const prisma = { superAdmin: { findUnique } } as unknown as PrismaService;
  const config = new ConfigService({ JWT_SECRET: 'x'.repeat(32) });
  return { strategy: new SuperAdminJwtStrategy(config, prisma), findUnique };
}

const adminAccess = {
  sub: 'admin-1',
  username: 'root',
  type: 'access',
  scope: SUPER_ADMIN_TOKEN_SCOPE,
} satisfies SuperAdminJwtTokenPayload;

describe('SuperAdminJwtStrategy', () => {
  it('accepts an access token of an active super admin', async () => {
    const { strategy } = build({ isActive: true });
    await expect(strategy.validate(adminAccess)).resolves.toEqual({
      adminId: 'admin-1',
      username: 'root',
    });
  });

  it('rejects a merchant access token signed with the shared secret', async () => {
    const { strategy, findUnique } = build({ isActive: true });
    await expect(
      strategy.validate({
        sub: 'user-1',
        type: 'access',
        ...({ phone: '+10000000000' } as object),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rejects refresh tokens', async () => {
    const { strategy } = build({ isActive: true });
    await expect(
      strategy.validate({ ...adminAccess, type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a deleted or deactivated admin', async () => {
    await expect(
      build(null).strategy.validate(adminAccess),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      build({ isActive: false }).strategy.validate(adminAccess),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
