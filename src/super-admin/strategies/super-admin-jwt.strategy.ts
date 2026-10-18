import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SUPER_ADMIN_TOKEN_SCOPE,
  type SuperAdminJwtPayload,
  type SuperAdminJwtTokenPayload,
} from '../interfaces/super-admin-jwt-payload.interface';

// Named strategy ('super-admin-jwt') so it never collides with the merchant
// JwtStrategy registered under the default 'jwt' name. When
// SUPER_ADMIN_JWT_SECRET is unset both sign with JWT_SECRET, so a valid
// signature alone proves nothing: the scope claim and a live, active
// SuperAdmin row are what make a token an admin token.
@Injectable()
export class SuperAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'super-admin-jwt',
) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret =
      configService.get<string>('SUPER_ADMIN_JWT_SECRET') ||
      configService.get<string>('JWT_SECRET');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret!,
    });
  }

  async validate(
    payload: Partial<SuperAdminJwtTokenPayload>,
  ): Promise<SuperAdminJwtPayload> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (payload.scope !== SUPER_ADMIN_TOKEN_SCOPE || !payload.sub) {
      throw new UnauthorizedException('Not a super admin token');
    }

    const admin = await this.prisma.superAdmin.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, isActive: true },
    });
    if (!admin?.isActive) {
      throw new UnauthorizedException('Not a super admin token');
    }

    return { adminId: admin.id, username: admin.username };
  }
}
