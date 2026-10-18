import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

const strategy = new JwtStrategy(
  new ConfigService({ JWT_SECRET: 'x'.repeat(32) }),
);

describe('JwtStrategy (merchant)', () => {
  it('accepts a merchant access token', () => {
    expect(
      strategy.validate({
        sub: 'user-1',
        phone: '+10000000000',
        type: 'access',
        rm: true,
      }),
    ).toEqual({ userId: 'user-1', phone: '+10000000000', rememberMe: true });
  });

  it('rejects a super admin access token signed with the shared secret', () => {
    expect(() =>
      strategy.validate({
        sub: 'admin-1',
        type: 'access',
        username: 'root',
        scope: 'super_admin',
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a legacy super admin token without the scope claim', () => {
    expect(() =>
      strategy.validate({
        sub: 'admin-1',
        type: 'access',
        username: 'root',
      } as never),
    ).toThrow(UnauthorizedException);
  });

  it('rejects refresh and password reset tokens', () => {
    for (const type of ['refresh', 'password_reset'] as const) {
      expect(() =>
        strategy.validate({ sub: 'user-1', phone: '+10000000000', type }),
      ).toThrow(UnauthorizedException);
    }
  });
});
