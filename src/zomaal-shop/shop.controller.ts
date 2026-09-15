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
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionGuard } from '../access/permission.guard';
import { RequirePermission } from '../access/require-permission.decorator';
import { CurrentStoreAccess } from '../access/current-store-access.decorator';
import type { StoreAccess } from '../access/store-access.service';
import { PERMISSIONS } from '../access/permissions';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { StorefrontService } from './storefront.service';
import { CartService } from './cart.service';
import { AddressService } from './address.service';
import { CheckoutService } from './checkout.service';
import { ShopOrdersService } from './shop-orders.service';
import {
  AddCartItemDto,
  CancelShopOrderDto,
  CheckoutPreviewDto,
  CreateShopAddressDto,
  ListShopOrdersDto,
  ListShopProductsDto,
  PlaceShopOrderDto,
  UpdateCartItemDto,
  UpdateShopAddressDto,
} from './dto/shop.dto';

const OBJ = { schema: { type: 'object' } } as const;
const ARR = { schema: { type: 'array', items: { type: 'object' } } } as const;

/**
 * The merchant-facing Zomaal Shop (mobile app screens: Explore the Shop,
 * Shop, Product Details, Favorites, My Cart, Shipping Address, Checkout,
 * Confirm Cash on Delivery). Browsing needs shop.view; anything that
 * changes the cart, addresses or orders needs shop.purchase. Owners hold
 * both. Favorites, cart, addresses and orders are per store, shared by the
 * owner and their staff.
 */
@ApiTags('Zomaal Shop')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@ApiForbiddenResponse({
  description: 'Missing shop.view / shop.purchase permission.',
  type: ApiErrorDto,
})
@Controller('shop')
export class ShopController {
  constructor(
    private readonly storefront: StorefrontService,
    private readonly cart: CartService,
    private readonly addresses: AddressService,
    private readonly checkout: CheckoutService,
    private readonly orders: ShopOrdersService,
  ) {}

  // ---- Browse ----

  @Get('home')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary:
      'Shop home: banners, categories, popular items, cart & favorites counts',
  })
  @ApiOkResponse(OBJ)
  home(@CurrentStoreAccess() access: StoreAccess) {
    return this.storefront.home(access.storeId);
  }

  @Get('categories')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary: 'Active categories that have products (with a cover image)',
  })
  @ApiOkResponse(ARR)
  categories() {
    return this.storefront.categories();
  }

  @Get('products')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'Browse/search products (paginated)' })
  @ApiOkResponse(OBJ)
  products(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: ListShopProductsDto,
  ) {
    return this.storefront.listProducts(access.storeId, query);
  }

  @Get('products/popular')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary:
      'Popular items: featured, then best sellers (90 days), then newest',
  })
  @ApiOkResponse(ARR)
  popular(@CurrentStoreAccess() access: StoreAccess) {
    return this.storefront.popular(access.storeId);
  }

  @Get('products/:id')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({
    summary:
      'Product Details: gallery, price/sale price, sizes, colors, variants, specifications',
  })
  @ApiOkResponse(OBJ)
  @ApiNotFoundResponse({ type: ApiErrorDto })
  product(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.storefront.productDetail(access.storeId, id);
  }

  // ---- Favorites ----

  @Get('favorites')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'Favorites' })
  @ApiOkResponse(ARR)
  favorites(@CurrentStoreAccess() access: StoreAccess) {
    return this.storefront.favorites(access.storeId);
  }

  @Post('favorites/:productId')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'Add a product to favorites (idempotent)' })
  @ApiOkResponse(OBJ)
  addFavorite(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.storefront.addFavorite(access.storeId, productId);
  }

  @Delete('favorites/:productId')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'Remove a product from favorites (idempotent)' })
  @ApiOkResponse(OBJ)
  removeFavorite(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('productId', ParseUUIDPipe) productId: string,
  ) {
    return this.storefront.removeFavorite(access.storeId, productId);
  }

  // ---- Cart ----

  @Get('cart')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary: 'My Cart',
    description:
      'Prices and stock are re-checked live; lines that can no longer be bought carry a `problem`.',
  })
  @ApiOkResponse(OBJ)
  getCart(@CurrentStoreAccess() access: StoreAccess) {
    return this.cart.get(access.storeId);
  }

  @Post('cart/items')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary:
      'Add to cart (merges with an existing line for the same product/option)',
  })
  @ApiCreatedResponse(OBJ)
  @ApiConflictResponse({ description: 'Not enough stock.', type: ApiErrorDto })
  addItem(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cart.addItem(access.storeId, dto);
  }

  @Patch('cart/items/:id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Change a cart line quantity' })
  @ApiOkResponse(OBJ)
  updateItem(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(access.storeId, id, dto.quantity);
  }

  @Delete('cart/items/:id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Remove from cart' })
  @ApiOkResponse(OBJ)
  removeItem(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.cart.removeItem(access.storeId, id);
  }

  @Delete('cart')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Clear All' })
  @ApiOkResponse(OBJ)
  clearCart(@CurrentStoreAccess() access: StoreAccess) {
    return this.cart.clear(access.storeId);
  }

  // ---- Addresses ----

  @Get('addresses')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Saved delivery addresses (default first)' })
  @ApiOkResponse(ARR)
  listAddresses(@CurrentStoreAccess() access: StoreAccess) {
    return this.addresses.list(access.storeId);
  }

  @Post('addresses')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Add Address' })
  @ApiCreatedResponse(OBJ)
  createAddress(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CreateShopAddressDto,
  ) {
    return this.addresses.create(access.storeId, dto);
  }

  @Patch('addresses/:id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Edit an address, or make it the default' })
  @ApiOkResponse(OBJ)
  updateAddress(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopAddressDto,
  ) {
    return this.addresses.update(access.storeId, id, dto);
  }

  @Delete('addresses/:id')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({ summary: 'Delete an address' })
  @ApiOkResponse(OBJ)
  deleteAddress(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.addresses.remove(access.storeId, id);
  }

  // ---- Checkout & orders ----

  @Post('checkout/preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary:
      'Checkout screen: totals, promo code result, address, payment methods, blockers',
    description:
      'Safe to call on every change (promo code typed, address switched). Nothing is reserved until POST /shop/orders.',
  })
  @ApiOkResponse(OBJ)
  preview(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: CheckoutPreviewDto,
  ) {
    return this.checkout.preview(access, dto);
  }

  @Post('orders')
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary: 'Place the order (Confirm Cash on Delivery Order)',
    description:
      'Atomic: claims the cart, reserves stock, and uses the promo in one transaction. A double-submit cannot create two orders.',
  })
  @ApiCreatedResponse(OBJ)
  @ApiConflictResponse({
    description: 'Stock ran out or the cart changed.',
    type: ApiErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description: 'Promo code invalid, or payment method unavailable.',
    type: ApiErrorDto,
  })
  placeOrder(
    @CurrentStoreAccess() access: StoreAccess,
    @Body() dto: PlaceShopOrderDto,
  ) {
    return this.checkout.placeOrder(access, dto);
  }

  @Get('orders')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'My Zomaal Shop orders' })
  @ApiOkResponse(ARR)
  listOrders(
    @CurrentStoreAccess() access: StoreAccess,
    @Query() query: ListShopOrdersDto,
  ) {
    return this.orders.listForStore(access.storeId, query.status);
  }

  @Get('orders/:id')
  @RequirePermission(PERMISSIONS.SHOP_VIEW)
  @ApiOperation({ summary: 'Order details' })
  @ApiOkResponse(OBJ)
  orderDetail(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.orders.detailForStore(access.storeId, id);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.SHOP_PURCHASE)
  @ApiOperation({
    summary: 'Cancel a pending order',
    description:
      'Only while PENDING. Stock is returned. Counts toward the Cash on Delivery cancellation limit.',
  })
  @ApiOkResponse(OBJ)
  @ApiConflictResponse({
    description: 'Order is no longer cancellable.',
    type: ApiErrorDto,
  })
  cancelOrder(
    @CurrentStoreAccess() access: StoreAccess,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelShopOrderDto,
  ) {
    return this.orders.cancelByMerchant(access.storeId, id, dto.reason);
  }
}
