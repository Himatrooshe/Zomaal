import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SuperAdminJwtTokenPayload } from '../interfaces/super-admin-jwt-payload.interface';

// Named strategy ('super-admin-jwt') so it never collides with the merchant
// JwtStrategy registered under the default 'jwt' name — a merchant access
// token and a super admin access token are never interchangeable.
@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'super-admin-jwt',
) {
  constructor(private configService: ConfigService) {
    const secret =
      configService.get<string>('SUPER_ADMIN_JWT_SECRET') ||
      configService.get<string>('JWT_SECRET');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret!,
    });
  }

  validate(payload: SuperAdminJwtTokenPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    return { adminId: payload.sub, username: payload.username };
  }
}
