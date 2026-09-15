import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { SuperAdminAuthService } from './super-admin-auth.service';
import { SuperAdminChangePasswordDto } from './dto/super-admin-change-password.dto';
import {
  MessageResponseDto,
  SuperAdminSummaryDto,
} from './dto/super-admin-response.dto';
import { SuperAdminJwtAuthGuard } from './guards/super-admin-jwt-auth.guard';
import { CurrentSuperAdmin } from './decorators/current-super-admin.decorator';
import type { SuperAdminJwtPayload } from './interfaces/super-admin-jwt-payload.interface';

@ApiTags('Admin Auth')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@Controller('admin')
export class SuperAdminController {
  constructor(private readonly superAdminAuthService: SuperAdminAuthService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the signed-in super admin identity' })
  @ApiOkResponse({ type: SuperAdminSummaryDto })
  @ApiUnauthorizedResponse({ type: ApiErrorDto })
  me(@CurrentSuperAdmin() admin: SuperAdminJwtPayload) {
    return this.superAdminAuthService.me(admin.adminId);
  }

  @Patch('me/password')
  @ApiOperation({ summary: 'Change the super admin password' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Not signed in, or current password is incorrect.',
    type: ApiErrorDto,
  })
  changePassword(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: SuperAdminChangePasswordDto,
  ) {
    return this.superAdminAuthService.changePassword(admin.adminId, dto);
  }
}
