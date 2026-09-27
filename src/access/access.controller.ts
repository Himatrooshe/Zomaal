import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  AccessMeResponseDto,
  PermissionsCatalogueResponseDto,
} from './dto/access.dto';
import {
  PERMISSIONS_BY_MODULE,
  type Permission,
  type PermissionModule,
} from './permissions';
import { StoreAccessService } from './store-access.service';

@ApiTags('Access')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('access')
export class AccessController {
  constructor(private readonly storeAccess: StoreAccessService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Session bootstrap — who am I and what can I do?',
    description:
      'Called after login so the app can hide modules without `*.view` and render Access Restricted on deep links. Owners get the full permission catalogue; staff get effective role/override permissions.',
  })
  @ApiOkResponse({ type: AccessMeResponseDto })
  me(@CurrentUser() user: JwtPayload): Promise<AccessMeResponseDto> {
    return this.storeAccess.session(user.userId);
  }

  @Get('permissions')
  @ApiOperation({
    summary: 'Permission catalogue for Add/Edit Staff toggles',
    description:
      'Returns every permission key grouped by module. Managing staff/roles is intentionally absent — those are owner-only and not expressible as a role permission.',
  })
  @ApiOkResponse({ type: PermissionsCatalogueResponseDto })
  catalogue(): PermissionsCatalogueResponseDto {
    return {
      modules: (
        Object.entries(PERMISSIONS_BY_MODULE) as [PermissionModule, Permission[]][]
      ).map(([module, permissions]) => ({ module, permissions })),
    };
  }
}
