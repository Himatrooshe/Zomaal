import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
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
import { StaffSalaryService } from './staff-salary.service';
import {
  CreateSalaryPaymentDto,
  SalaryPaymentBatchResponseDto,
  SalaryPaymentListQueryDto,
  SalaryPaymentListResponseDto,
  SalaryProfileResponseDto,
  SalaryProfileWrapperDto,
  SetSalaryProfileDto,
} from './dto/staff-salary.dto';

@ApiTags('Staff Salary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid Zomaal access token.', type: ApiErrorDto })
@ApiForbiddenResponse({ description: 'Only the store owner can manage salaries.', type: ApiErrorDto })
@Controller('staff')
export class StaffSalaryController {
  constructor(private readonly salary: StaffSalaryService) {}

  @Get(':staffId/salary')
  @ApiOperation({ summary: 'Get a staff member\'s salary profile (Manage Salary Info screen)' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryProfileWrapperDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.', type: ApiErrorDto })
  getProfile(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
  ): Promise<SalaryProfileWrapperDto> {
    return this.salary.getProfile(user.userId, staffId);
  }

  @Put(':staffId/salary')
  @ApiOperation({
    summary: 'Set/update a staff member\'s salary profile',
    description:
      'AUTOMATIC generates the salary expense on schedule and blocks manual entries for this person; MANUAL requires the owner to record each payment.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryProfileResponseDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.', type: ApiErrorDto })
  setProfile(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() dto: SetSalaryProfileDto,
  ): Promise<SalaryProfileResponseDto> {
    return this.salary.setProfile(user.userId, staffId, dto);
  }

  @Get(':staffId/salary/payments')
  @ApiOperation({ summary: 'List salary payment history for a staff member' })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryPaymentListResponseDto })
  @ApiNotFoundResponse({ description: 'Staff member not found.', type: ApiErrorDto })
  listPayments(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Query() query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    return this.salary.listPayments(user.userId, staffId, query);
  }

  @Post('salary/payments')
  @ApiOperation({
    summary: 'Record manual salary payment(s) (Add Salary Record: choose staff, then add salary)',
    description:
      'Supports multi-select. Blocked, per staff member, when their salary profile is AUTOMATIC.',
  })
  @ApiOkResponse({ type: SalaryPaymentBatchResponseDto })
  @ApiNotFoundResponse({ description: 'One or more staff members not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'Manual entry is blocked for one or more staff members because automatic is on.',
    type: ApiErrorDto,
  })
  createPayments(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalaryPaymentDto,
  ): Promise<SalaryPaymentBatchResponseDto> {
    return this.salary.createPayments(user.userId, dto);
  }
}
