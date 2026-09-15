import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import type { WarehouseMediaUploadFile } from '../../warehouse/media.service';
import { ShopSettingsService } from '../../zomaal-shop/shop-settings.service';
import {
  ActivityEntity,
  ActivityLogService,
} from '../activity/activity-log.service';
import { CurrentSuperAdmin } from '../decorators/current-super-admin.decorator';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import { ShopBannersService } from './shop-banners.service';
import { ShopPromoCodesService } from './shop-promo-codes.service';
import { ShopOrdersAdminService } from './shop-orders-admin.service';
import {
  AdminCancelShopOrderDto,
  AdminListShopOrdersDto,
  AdvanceShopOrderDto,
  CreateShopBannerDto,
  CreateShopPromoCodeDto,
  UpdateShopBannerDto,
  UpdateShopOrderNoteDto,
  UpdateShopPromoCodeDto,
  UpdateShopSettingsDto,
} from './dto/storefront-admin.dto';

const OBJ = { schema: { type: 'object' } } as const;

@ApiTags('Admin Shop Operations')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin/shop')
export class ShopStorefrontAdminController {
  constructor(
    private readonly banners: ShopBannersService,
    private readonly promos: ShopPromoCodesService,
    private readonly orders: ShopOrdersAdminService,
    private readonly settings: ShopSettingsService,
    private readonly activity: ActivityLogService,
  ) {}

  // ---- Orders ----

  @Get('orders')
  @ApiOperation({ summary: 'All merchant orders from the Zomaal Shop' })
  @ApiOkResponse(OBJ)
  listOrders(@Query() query: AdminListShopOrdersDto) {
    return this.orders.list(query);
  }

  // Declared before `orders/:id` so "export" is never read as an id.
  @Get('orders/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="zomaal-shop-orders.csv"',
  )
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export orders as CSV (same filters as the list)',
  })
  exportOrders(@Query() query: AdminListShopOrdersDto) {
    return this.orders.exportCsv(query);
  }

  @Get('orders/:id')
  @ApiOperation({ summary: 'Order detail' })
  @ApiOkResponse(OBJ)
  order(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(id);
  }

  @Post('orders/:id/status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move an order forward: CONFIRMED → SHIPPED → DELIVERED',
    description:
      'Steps may be skipped. DELIVERED marks Cash on Delivery as paid and adds the items to the merchant’s Purchases (From Shop).',
  })
  @ApiOkResponse(OBJ)
  @ApiConflictResponse({
    description: 'Order is not in a state that allows this.',
    type: ApiErrorDto,
  })
  advance(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdvanceShopOrderDto,
  ) {
    return this.orders.advance(admin, id, dto.status, dto.trackingNumber);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel an order before delivery (stock is returned)',
  })
  @ApiOkResponse(OBJ)
  cancel(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminCancelShopOrderDto,
  ) {
    return this.orders.cancel(admin, id, dto.reason);
  }

  @Patch('orders/:id/note')
  @ApiOperation({ summary: 'Internal note (never shown to the merchant)' })
  @ApiOkResponse(OBJ)
  note(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopOrderNoteDto,
  ) {
    return this.orders.updateNote(admin, id, dto.adminNote);
  }

  // ---- Banners ----

  @Get('banners')
  @ApiOperation({ summary: 'Shop home banners' })
  @ApiOkResponse(OBJ)
  listBanners() {
    return this.banners.list();
  }

  @Post('banners')
  @ApiOperation({ summary: 'Create a banner (then upload its image)' })
  @ApiOkResponse(OBJ)
  createBanner(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: CreateShopBannerDto,
  ) {
    return this.banners.create(admin, dto);
  }

  @Patch('banners/:id')
  @ApiOperation({ summary: 'Update a banner' })
  @ApiOkResponse(OBJ)
  updateBanner(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopBannerDto,
  ) {
    return this.banners.update(admin, id, dto);
  }

  @Delete('banners/:id')
  @ApiOperation({ summary: 'Delete a banner' })
  @ApiOkResponse(OBJ)
  deleteBanner(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.banners.remove(admin, id);
  }

  @Post('banners/:id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: { image: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: 'Upload or replace the banner image (JPEG/PNG/WebP, max 5 MB)',
  })
  @ApiOkResponse(OBJ)
  bannerImage(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() image?: WarehouseMediaUploadFile,
  ) {
    return this.banners.uploadImage(admin, id, image);
  }

  // ---- Promo codes ----

  @Get('promo-codes')
  @ApiOperation({ summary: 'Promo codes with usage stats' })
  @ApiOkResponse(OBJ)
  listPromos() {
    return this.promos.list();
  }

  @Post('promo-codes')
  @ApiOperation({ summary: 'Create a promo code' })
  @ApiOkResponse(OBJ)
  createPromo(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: CreateShopPromoCodeDto,
  ) {
    return this.promos.create(admin, dto);
  }

  @Patch('promo-codes/:id')
  @ApiOperation({ summary: 'Update a promo code' })
  @ApiOkResponse(OBJ)
  updatePromo(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopPromoCodeDto,
  ) {
    return this.promos.update(admin, id, dto);
  }

  @Delete('promo-codes/:id')
  @ApiOperation({
    summary: 'Delete a promo code (past orders keep the code they used)',
  })
  @ApiOkResponse(OBJ)
  deletePromo(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.promos.remove(admin, id);
  }

  // ---- Settings ----

  @Get('settings')
  @ApiOperation({
    summary: 'Shop settings: currency, delivery fee, Cash on Delivery rules',
  })
  @ApiOkResponse(OBJ)
  async getSettings() {
    return this.settings.toResponse(await this.settings.get());
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update shop settings' })
  @ApiOkResponse(OBJ)
  async updateSettings(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: UpdateShopSettingsDto,
  ) {
    const before = this.settings.toResponse(await this.settings.get());
    const after = this.settings.toResponse(await this.settings.update(dto));
    const changes = Object.fromEntries(
      (Object.keys(dto) as (keyof typeof before)[])
        .filter((k) => before[k] !== after[k])
        .map((k) => [k, { from: before[k], to: after[k] }]),
    );
    if (Object.keys(changes).length) {
      await this.activity.record(admin, {
        action: 'SHOP_SETTINGS_UPDATED',
        entityType: ActivityEntity.SHOP_SETTINGS,
        summary: `Updated shop settings (${Object.keys(changes).join(', ')})`,
        metadata: changes,
      });
    }
    return after;
  }
}
