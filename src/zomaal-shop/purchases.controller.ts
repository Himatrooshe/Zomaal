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
 * Merchant Purchases — one ledger, two ways in:
 *
 * 1. From Shop (source=SHOP) — merchant buys packaging/products in the
 *    Zomaal Shop; when admin marks the order DELIVERED, rows appear here
 *    automatically and are read-only. Also credits packaging stock for
 *    Add Product → Select packaging.
 *
 * 2. Manual / Add Purchase (source=MANUAL) — merchant bought outside the
 *    app (supplier, market, etc.) and records qty + unit price + date
 *    against one of their own warehouse products (Select Product sheet).
 *
 * Figma: Purchases List (All / Manual / From Shop), Purchases Details
 * history, Add Purchase, Select Product.
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
    description:
      'Use tab=ALL|MANUAL|FROM_SHOP (Figma). Each item has source + sourceLabel.',
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
    summary:
      'Add Purchase → Select Product: your warehouse products (not Zomaal Shop catalog)',
    description:
      'Personal/outside purchases link to products the merchant already owns in Warehouse. To buy from Zomaal, use /shop instead — delivery creates From Shop rows automatically.',
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
      'Purchases Details: product card + history (date, qty, box price, total)',
  })
  @ApiOkResponse(OBJ)
  @ApiNotFoundResponse({ type: ApiErrorDto })
  group(@CurrentStoreAccess() access: StoreAccess, @Param('key') key: string) {
    return this.purchases.group(access.storeId, key);
  }

  @Post()
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary: 'Add Purchase (manual / personal / outside the Zomaal Shop)',
    description:
      'Records qty × unit price × date against a warehouse product. Does not create a Zomaal Shop order — use POST /shop/orders for that.',
  })
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
