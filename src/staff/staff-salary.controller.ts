import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../common/dto/monthly-trend.dto';
import { StaffSalaryService } from './staff-salary.service';
import {
  ConfirmSalaryPaymentDto,
  SalaryAnnualQueryDto,
  SalaryAnnualSummaryDto,
  SalaryPaymentResponseDto,
  CreateSalaryPaymentDto,
  SalaryPaymentBatchResponseDto,
  SalaryPaymentListQueryDto,
  SalaryPaymentListResponseDto,
  SalaryProfileResponseDto,
  SalaryProfileWrapperDto,
  SalarySummaryResponseDto,
  SetSalaryProfileDto,
} from './dto/staff-salary.dto';

@ApiTags('Staff Salary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: 'Only the store owner can manage salaries.',
  type: ApiErrorDto,
})
@Controller('staff')
export class StaffSalaryController {
  constructor(private readonly salary: StaffSalaryService) {}

  // Static /staff/salary/* routes MUST stay above :staffId or "salary" is captured as an id.

  @Get('salary/summary')
  @ApiOperation({
    summary: 'Salary tab totals (Total Salary Paid / Pending Payments)',
  })
  @ApiOkResponse({ type: SalarySummaryResponseDto })
  summary(@CurrentUser() user: JwtPayload): Promise<SalarySummaryResponseDto> {
    return this.salary.summary(user.userId);
  }

  @Get('salary/trend')
  @ApiOperation({
    summary: 'Monthly payout totals across all staff (Salary bar chart)',
  })
  @ApiOkResponse({ type: MonthlyTrendResponseDto })
  trend(
    @CurrentUser() user: JwtPayload,
    @Query() query: MonthlyTrendQueryDto,
  ): Promise<MonthlyTrendResponseDto> {
    return this.salary.trend(user.userId, query);
  }

  @Get('salary/payments')
  @ApiOperation({
    summary:
      'List salary payments across all staff (All / Paid / Pending / Overdue filters)',
  })
  @ApiOkResponse({ type: SalaryPaymentListResponseDto })
  listStorePayments(
    @CurrentUser() user: JwtPayload,
    @Query() query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    return this.salary.listStorePayments(user.userId, query);
  }

  @Post('salary/payments')
  @ApiOperation({
    summary: 'Add salary record(s) for selected staff',
    description:
      'Defaults to PENDING. PAID explicitly confirms payment now. Reuse the idempotency key for retries. One salary obligation per staff member per UTC date; use the existing record when already accrued.',
  })
  @ApiOkResponse({ type: SalaryPaymentBatchResponseDto })
  @ApiNotFoundResponse({
    description: 'One or more staff members not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'A record for this salary date exists, or the retry key was reused with different data.',
    type: ApiErrorDto,
  })
  createPayments(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSalaryPaymentDto,
  ): Promise<SalaryPaymentBatchResponseDto> {
    return this.salary.createPayments(user.userId, dto);
  }

  @Post('salary/payments/:paymentId/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm an actual salary payout (retry safe)' })
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryPaymentResponseDto })
  confirmPayment(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
    @Body() dto: ConfirmSalaryPaymentDto,
  ): Promise<SalaryPaymentResponseDto> {
    return this.salary.confirmPayment(user.userId, paymentId, dto);
  }

  @Post('salary/payments/:paymentId/expense')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record the linked expense for a paid salary (retry safe)',
    description:
      'Uses the confirmed salary amount, payment timestamp and method. Returns the same expense on retries.',
  })
  @ApiParam({ name: 'paymentId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryPaymentResponseDto })
  recordExpense(
    @CurrentUser() user: JwtPayload,
    @Param('paymentId', new ParseUUIDPipe()) paymentId: string,
  ): Promise<SalaryPaymentResponseDto> {
    return this.salary.recordExpense(user.userId, paymentId);
  }

  @Get(':staffId/salary/annual-summary')
  @ApiOperation({
    summary: 'Annual salary paid and remaining obligations',
    description:
      'Calendar year in UTC. Annual total is a projection, not a contractual commitment; future occurrences use the current profile.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryAnnualSummaryDto })
  annualSummary(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Query() query: SalaryAnnualQueryDto,
  ): Promise<SalaryAnnualSummaryDto> {
    return this.salary.annualSummary(user.userId, staffId, query);
  }

  @Get(':staffId/salary')
  @ApiOperation({
    summary: "Get a staff member's salary profile (Manage Salary Info screen)",
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryProfileWrapperDto })
  @ApiNotFoundResponse({
    description: 'Staff member not found.',
    type: ApiErrorDto,
  })
  getProfile(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
  ): Promise<SalaryProfileWrapperDto> {
    return this.salary.getProfile(user.userId, staffId);
  }

  @Put(':staffId/salary')
  @ApiOperation({
    summary: "Set/update a staff member's salary profile",
    description:
      'AUTOMATIC marks the due record PAID and creates its Expense on schedule. MANUAL creates a PENDING record; the owner records its Expense to mark it PAID. Both actions are linked to the individual staff member.',
  })
  @ApiParam({ name: 'staffId', format: 'uuid' })
  @ApiOkResponse({ type: SalaryProfileResponseDto })
  @ApiNotFoundResponse({
    description: 'Staff member not found.',
    type: ApiErrorDto,
  })
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
  @ApiNotFoundResponse({
    description: 'Staff member not found.',
    type: ApiErrorDto,
  })
  listPayments(
    @CurrentUser() user: JwtPayload,
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Query() query: SalaryPaymentListQueryDto,
  ): Promise<SalaryPaymentListResponseDto> {
    return this.salary.listPayments(user.userId, staffId, query);
  }
}
