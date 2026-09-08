import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { RolesService } from './roles.service';
import {
  CreateRoleDto,
  RoleListResponseDto,
  RoleResponseDto,
  UpdateRoleDto,
} from './dto/role.dto';

@ApiTags('Roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid Zomaal access token.', type: ApiErrorDto })
@ApiForbiddenResponse({
  description: 'Only the store owner can manage roles.',
  type: ApiErrorDto,
})
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @ApiOperation({
    summary: 'List roles for the store (Staff management screen)',
    description: 'Owner-only. Role management can never be delegated to a staff member.',
  })
  @ApiOkResponse({ type: RoleListResponseDto })
  async list(@CurrentUser() user: JwtPayload): Promise<RoleListResponseDto> {
    return { roles: await this.roles.list(user.userId) };
  }

  @Post()
  @ApiOperation({ summary: 'Create a role (owner-only)' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiConflictResponse({ description: 'A role with this name already exists.', type: ApiErrorDto })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.roles.create(user.userId, dto);
  }

  @Patch(':roleId')
  @ApiOperation({ summary: 'Update a role (owner-only)' })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiOkResponse({ type: RoleResponseDto })
  @ApiNotFoundResponse({ description: 'Role not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'A role with this name already exists, or the role is a system role.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    return this.roles.update(user.userId, roleId, dto);
  }

  @Delete(':roleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a role (owner-only)',
    description: 'Blocked while any staff member is still assigned to this role.',
  })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Role not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'The role is a system role, or still has staff assigned to it.',
    type: ApiErrorDto,
  })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ): Promise<void> {
    return this.roles.remove(user.userId, roleId);
  }
}
