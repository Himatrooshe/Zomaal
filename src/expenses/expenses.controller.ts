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
  Query,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { PERMISSIONS } from '../access/permissions';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { ExpensesService } from './expenses.service';
import {
  CreateExpenseCategoryDto,
  ExpenseCategoryListResponseDto,
  ExpenseCategoryResponseDto,
  UpdateExpenseCategoryDto,
} from './dto/expense-category.dto';
import {
  CreateExpenseDto,
  ExpenseListQueryDto,
  ExpenseListResponseDto,
  ExpenseResponseDto,
  ExpenseSummaryQueryDto,
  ExpenseSummaryResponseDto,
  UpdateExpenseDto,
} from './dto/expense.dto';

@ApiTags('Expenses')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({ description: 'Missing or invalid Zomaal access token.', type: ApiErrorDto })
@ApiForbiddenResponse({ description: "You don't have permission to access Expenses.", type: ApiErrorDto })
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // ---- Categories (declared before :expenseId so they aren't shadowed) ---

  @Get('categories')
  @RequirePermission(PERMISSIONS.EXPENSES_VIEW)
  @ApiOperation({ summary: 'List expense categories (Add Expense / Create Category screens)' })
  @ApiOkResponse({ type: ExpenseCategoryListResponseDto })
  async listCategories(
    @CurrentStoreAccess() access: StoreAccess,
  ): Promise<ExpenseCategoryListResponseDto> {
    return { categories: await this.expenses.listCategories(access.storeId) };
  }

  @Post('categories')
  @RequirePermission(PERMISSIONS.EXPENSES_ADD)
  @ApiOperation({ summary: 'Create an expense category (Create Category screen)' })
  @ApiOkResponse({ type: ExpenseCategoryResponseDto })
  @ApiConflictResponse({ description: 'A category with this name already exists.', type: ApiErrorDto })
  createCategory(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CreateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    return this.expenses.createCategory(access.storeId, dto);
  }

  @Patch('categories/:categoryId')
  @RequirePermission(PERMISSIONS.EXPENSES_EDIT)
  @ApiOperation({ summary: 'Update an expense category' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiOkResponse({ type: ExpenseCategoryResponseDto })
  @ApiNotFoundResponse({ description: 'Category not found.', type: ApiErrorDto })
  @ApiConflictResponse({ description: 'A category with this name already exists.', type: ApiErrorDto })
  updateCategory(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategoryResponseDto> {
    return this.expenses.updateCategory(access.storeId, categoryId, dto);
  }

  @Delete('categories/:categoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSIONS.EXPENSES_DELETE)
  @ApiOperation({ summary: 'Delete an expense category' })
  @ApiParam({ name: 'categoryId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Category not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'The category is a system category, or still has expenses recorded against it.',
    type: ApiErrorDto,
  })
  removeCategory(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('categoryId', new ParseUUIDPipe()) categoryId: string,
  ): Promise<void> {
    return this.expenses.removeCategory(access.storeId, categoryId);
  }

  // ---- Summary (also before :expenseId) -----------------------------------

  @Get('summary')
  @RequirePermission(PERMISSIONS.EXPENSES_VIEW)
  @ApiOperation({ summary: 'Totals by group (Expenses Breakdown screen)' })
  @ApiOkResponse({ type: ExpenseSummaryResponseDto })
  summary(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: ExpenseSummaryQueryDto,
  ): Promise<ExpenseSummaryResponseDto> {
    return this.expenses.summary(access.storeId, query);
  }

  // ---- Expenses ------------------------------------------------------------

  @Get()
  @RequirePermission(PERMISSIONS.EXPENSES_VIEW)
  @ApiOperation({ summary: 'List/search expenses (Expenses screen)' })
  @ApiOkResponse({ type: ExpenseListResponseDto })
  list(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: ExpenseListQueryDto,
  ): Promise<ExpenseListResponseDto> {
    return this.expenses.list(access.storeId, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.EXPENSES_ADD)
  @ApiOperation({
    summary: 'Add an expense (Add Expense screen)',
    description: 'Categories in the SALARY group are rejected here — record those from Staff Salary instead.',
  })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ description: 'Category not found.', type: ApiErrorDto })
  @ApiConflictResponse({ description: 'The category is a SALARY-group category.', type: ApiErrorDto })
  create(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CreateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.create(access, dto);
  }

  @Patch(':expenseId')
  @RequirePermission(PERMISSIONS.EXPENSES_EDIT)
  @ApiOperation({ summary: 'Edit an expense' })
  @ApiParam({ name: 'expenseId', format: 'uuid' })
  @ApiOkResponse({ type: ExpenseResponseDto })
  @ApiNotFoundResponse({ description: 'Expense or category not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'The expense was generated from a salary payment, or the new category is SALARY-group.',
    type: ApiErrorDto,
  })
  update(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<ExpenseResponseDto> {
    return this.expenses.update(access, expenseId, dto);
  }

  @Delete(':expenseId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSIONS.EXPENSES_DELETE)
  @ApiOperation({ summary: 'Delete an expense' })
  @ApiParam({ name: 'expenseId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Expense not found.', type: ApiErrorDto })
  @ApiConflictResponse({
    description: 'The expense was generated from a salary payment.',
    type: ApiErrorDto,
  })
  remove(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('expenseId', new ParseUUIDPipe()) expenseId: string,
  ): Promise<void> {
    return this.expenses.remove(access, expenseId);
  }
}
