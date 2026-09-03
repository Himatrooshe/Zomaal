import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { RevenueRangeQueryDto } from '../ecommerce/dto/revenue-query.dto';
import { ExpenseService } from './expense.service';
import {
  ExpenseListDto,
  ExpenseListQueryDto,
  ExpenseSummaryResponseDto,
} from './dto/expense.dto';

const PRIVATE_NO_STORE_HEADERS = {
  'Cache-Control': {
    description: 'Expense data is private to the authenticated store and must not be cached.',
    schema: { type: 'string', example: 'private, no-store' },
  },
};

// Read-only on purpose, for now. Nothing writes to ExpenseEntry today, so
// these will always report empty/zero — kept query-only rather than a
// manual-entry ledger so a screen labeled "Operational Cost" etc. never
// shows a number that isn't backed by a real, deliberate source.
@ApiTags('Finance — Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('finance/expenses')
export class ExpenseController {
  constructor(private readonly expenseService: ExpenseService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'List logged expenses',
    description: 'Always returns an empty list today — see the controller-level note.',
  })
  @ApiOkResponse({ type: ExpenseListDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid query parameters.', type: ApiErrorDto })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ExpenseListQueryDto,
  ): Promise<ExpenseListDto> {
    return this.expenseService.list(user.userId, query);
  }

  @Get('summary')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({
    summary: 'Get expense totals by category',
    description:
      'Backs the Expenses screen tiles (Operational / Purchases / Advertising / Packaging). ' +
      'Every number is 0 today — see the controller-level note. Defaults to the current ' +
      'calendar month.',
  })
  @ApiOkResponse({ type: ExpenseSummaryResponseDto, headers: PRIVATE_NO_STORE_HEADERS })
  @ApiBadRequestResponse({ description: 'Invalid date range or timezone.', type: ApiErrorDto })
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: RevenueRangeQueryDto,
  ): Promise<ExpenseSummaryResponseDto> {
    return this.expenseService.getSummary(user.userId, query);
  }
}
