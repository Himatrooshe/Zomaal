import {
  Body,
  Controller,
  Delete,
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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
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
import { PurchasesService } from './purchases.service';
import {
  CreatePurchaseDto,
  ListPurchasesDto,
  PurchaseProductOptionsDto,
  UpdatePurchaseDto,
} from './dto/shop.dto';

const OBJ = { schema: { type: 'object' } } as const;

/**
 * Merchant Purchases (screens: Purchases List, Purchases Details, Add
 * Purchase, Select Product). "From Shop" rows are created automatically when
 * a Zomaal Shop order is delivered and are read-only; "Manual" rows are the
 * merchant's own supplier purchases.
 */
@ApiTags('Purchases')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({ description: 'Missing permission.', type: ApiErrorDto })
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary:
      'Purchases List: totals + one row per product (All / Manual / From Shop)',
  })
  @ApiOkResponse(OBJ)
  list(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: ListPurchasesDto,
  ) {
    return this.purchases.list(access.storeId, query);
  }

  // Declared before :key so "product-options" is never read as a group key.
  @Get('product-options')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE, PERMISSIONS.PRODUCTS_VIEW)
  @ApiOperation({
    summary: 'Select Product sheet: your own products with stock and price',
  })
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'object' } } })
  productOptions(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: PurchaseProductOptionsDto,
  ) {
    return this.purchases.productOptions(access.storeId, query.search);
  }

  @Get('groups/:key')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary:
      'Purchases Details: purchase history for one product (key from the list)',
  })
  @ApiOkResponse(OBJ)
  @ApiNotFoundResponse({ type: ApiErrorDto })
  group(@CurrentStoreAccess() access: StoreAccess, @Param('key') key: string) {
    return this.purchases.group(access.storeId, key);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Add Purchase (manual)' })
  @ApiCreatedResponse(OBJ)
  create(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchases.create(access, dto);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary: 'Edit a manual purchase (From Shop entries are read-only)',
  })
  @ApiOkResponse(OBJ)
  update(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseDto,
  ) {
    return this.purchases.update(access.storeId, id, dto);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Delete a manual purchase' })
  @ApiOkResponse(OBJ)
  remove(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.purchases.remove(access.storeId, id);
  }
}
