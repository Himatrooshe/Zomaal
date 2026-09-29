import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { FileInterceptor } from '@nestjs/platform-express';
import { ProfileMediaService } from '../profile-media/profile-media.service';
import type { WarehouseMediaUploadFile } from '../warehouse/media.service';
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
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: 'Only the store owner can manage staff.',
  type: ApiErrorDto,
})
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staff: StaffService,
    private readonly media: ProfileMediaService,
  ) {}

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
  @ApiNotFoundResponse({
    description: 'Staff member not found.',
    type: ApiErrorDto,
  })
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
  @ApiConflictResponse({
    description: 'This phone number is already registered.',
    type: ApiErrorDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStaffDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.create(user.userId, dto);
  }

  @Patch(':staffId')
  @ApiOperation({
    summary: 'Edit a staff member (Edit Staff info screen)',
    description:
      'Leave `password` blank/omitted to keep it unchanged. It is never returned in any response.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiNotFoundResponse({
    description: 'Staff member or role not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'This phone number is already registered.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.update(user.userId, staffId, dto);
  }

  @Post(':staffId/photo')
  @HttpCode(200)
  @ApiOperation({ summary: 'Upload or replace a staff photo (owner only)' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['photo'],
      properties: { photo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @UseInterceptors(
    FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadPhoto(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @UploadedFile() file?: WarehouseMediaUploadFile,
  ): Promise<StaffDetailResponseDto> {
    await this.media.uploadStaffPhoto(user.userId, staffId, file);
    return this.staff.details(user.userId, staffId);
  }

  @Patch(':staffId/status')
  @ApiOperation({
    summary: 'Deactivate or reactivate a staff member',
    description:
      'Removal is deactivate-only — staff members are never deleted.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  @ApiNotFoundResponse({
    description: 'Staff member not found.',
    type: ApiErrorDto,
  })
  setStatus(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() dto: UpdateStaffStatusDto,
  ): Promise<StaffDetailResponseDto> {
    return this.staff.setStatus(user.userId, staffId, dto.status);
  }
}
