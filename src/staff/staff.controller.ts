import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
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
import { StaffService } from './staff.service';
import {
  CreateStaffDto,
  StaffDetailResponseDto,
  StaffListQueryDto,
  StaffListResponseDto,
  UpdateStaffDto,
  UpdateStaffStatusDto,
} from './dto/staff.dto';

@ApiTags('Staff')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid Zomaal access token.', type: ApiErrorDto })
@ApiForbiddenResponse({
  description: 'Only the store owner can manage staff.',
  type: ApiErrorDto,
})
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @ApiOperation({ summary: 'List/search staff (Staff management screen)' })
  @ApiOkResponse({ type: StaffListResponseDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: StaffListQueryDto,
  ): Promise<StaffListResponseDto> {
    return this.staff.list(user.userId, query);
  }

  @Get(':staffId')
  @ApiOperation({ summary: 'Staff details (Staff Details screen)' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.', type: ApiErrorDto })
  details(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.details(user.userId, staffId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a new staff member (Add New Staff screen)',
    description:
      'Creates a login (phone + password) and a staff profile in one call. The phone must not already belong to another account.',
  })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiConflictResponse({ description: 'This phone number is already registered.', type: ApiErrorDto })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.create(user.userId, dto);
  }

  @Patch(':staffId')
  @ApiOperation({
    summary: 'Edit a staff member (Edit Staff info screen)',
    description: 'Leave `password` blank/omitted to keep it unchanged. It is never returned in any response.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Staff member or role not found.', type: ApiErrorDto })
  @ApiConflictResponse({ description: 'This phone number is already registered.', type: ApiErrorDto })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.update(user.userId, staffId, dto);
  }

  @Patch(':staffId/status')
  @ApiOperation({
    summary: 'Deactivate or reactivate a staff member',
    description: 'Removal is deactivate-only — staff members are never deleted.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.', type: ApiErrorDto })
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() dto: UpdateStaffStatusDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.setStatus(user.userId, staffId, dto.status);
  }
}
