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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { PERMISSIONS } from '../access/permissions';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import type { WarehouseMediaUploadFile } from '../warehouse/media.service';
import {
  MonthlyTrendQueryDto,
  MonthlyTrendResponseDto,
} from '../common/dto/monthly-trend.dto';
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
  ExpenseReceiptResponseDto,
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

  // ---- Receipts (also before :expenseId; shared by Expenses and Staff Salary) --

  @Post('receipts')
  @RequirePermission(PERMISSIONS.EXPENSES_ADD)
  @UseInterceptors(FileInterceptor('receipt', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['receipt'],
      properties: {
        receipt: {
          type: 'string',
          format: 'binary',
          description: 'Real JPEG, PNG, or WebP bytes, maximum 5 MiB.',
        },
      },
    },
  })
  @ApiOperation({
    summary: 'Upload a receipt photo (Add Expense / Add Salary Record screens)',
    description:
      'Stores the image privately and returns an id valid for 24 hours. Pass it as receiptAssetId when creating the expense or salary payment to attach it permanently.',
  })
  @ApiCreatedResponse({ type: ExpenseReceiptResponseDto })
  @ApiBadRequestResponse({ description: 'Missing file or unsupported/corrupt image.', type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ description: 'Private image storage is unavailable.', type: ApiErrorDto })
  uploadReceipt(
    @CurrentStoreAccess() access: StoreAccess,
    @UploadedFile() file?: WarehouseMediaUploadFile,
  ): Promise<ExpenseReceiptResponseDto> {
    return this.expenses.uploadReceipt(access, file);
  }

  @Get('receipts/:assetId')
  @RequirePermission(PERMISSIONS.EXPENSES_VIEW)
  @ApiParam({ name: 'assetId', format: 'uuid' })
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  @ApiOperation({ summary: 'Read a private receipt photo' })
  @ApiOkResponse({ description: 'Raw image bytes.', schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({ description: 'Receipt not found.', type: ApiErrorDto })
  @ApiServiceUnavailableResponse({ description: 'The private image could not be read.', type: ApiErrorDto })
  streamReceipt(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('assetId', new ParseUUIDPipe()) assetId: string,
    @Res() response: Response,
  ): Promise<void> {
    return this.expenses.streamReceipt(access, assetId, response);
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

  @Get('trend')
  @RequirePermission(PERMISSIONS.EXPENSES_VIEW)
  @ApiOperation({ summary: 'Monthly totals (Expenses line chart)' })
  @ApiOkResponse({ type: MonthlyTrendResponseDto })
  trend(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: MonthlyTrendQueryDto,
  ): Promise<MonthlyTrendResponseDto> {
    return this.expenses.trend(access.storeId, query);
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
