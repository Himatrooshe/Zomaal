import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminLoginDto } from './dto/super-admin-login.dto';
import { SuperAdminRefreshTokenDto } from './dto/super-admin-refresh.dto';
import {
  MessageResponseDto,
  SuperAdminAuthResponseDto,
  SuperAdminTokenPairDto,
} from './dto/super-admin-response.dto';
import { SuperAdminJwtAuthGuard } from './guards/super-admin-jwt-auth.guard';
import { CurrentSuperAdmin } from './decorators/current-super-admin.decorator';
import type { SuperAdminJwtPayload } from './interfaces/super-admin-jwt-payload.interface';

const tokenResponseHeaders = {
  'Cache-Control': {
    description: 'Prevents access and refresh tokens from being cached.',
    schema: { type: 'string', example: 'no-store' },
  },
};

// Deliberately separate from AuthController/'auth' — this is the single
// platform-level super admin identity, never a merchant `User`. Tokens
// issued here are signed with SUPER_ADMIN_JWT_SECRET and are rejected by
// every merchant-facing endpoint, and vice versa.
@ApiTags('Admin Auth')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@Controller('admin/auth')
export class SuperAdminAuthController {
  constructor(private readonly superAdminAuthService: SuperAdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Sign in to the Zomaal Shop admin panel',
    description:
      'Single super admin identity, configured via SUPERADMIN_USERNAME/SUPERADMIN_PASSWORD.',
  })
  @ApiOkResponse({
    type: SuperAdminAuthResponseDto,
    headers: tokenResponseHeaders,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid username or password.',
    type: ApiErrorDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many login attempts.',
    type: ApiErrorDto,
  })
  login(@Body() dto: SuperAdminLoginDto) {
    return this.superAdminAuthService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exchange a refresh token for a new token pair' })
  @ApiOkResponse({
    type: SuperAdminTokenPairDto,
    headers: tokenResponseHeaders,
  })
  @ApiUnauthorizedResponse({
    description: 'Refresh token is invalid, expired, or revoked.',
    type: ApiErrorDto,
  })
  refresh(@Body() dto: SuperAdminRefreshTokenDto) {
    return this.superAdminAuthService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SuperAdminJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  logout(@CurrentSuperAdmin() admin: SuperAdminJwtPayload) {
    return this.superAdminAuthService.logout(admin.adminId);
  }
}
