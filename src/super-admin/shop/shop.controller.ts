import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiErrorDto } from '../../common/dto/api-error.dto';
import type { WarehouseMediaUploadFile } from '../../warehouse/media.service';
import { CurrentSuperAdmin } from '../decorators/current-super-admin.decorator';
import { SuperAdminJwtAuthGuard } from '../guards/super-admin-jwt-auth.guard';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';
import { MAX_PRODUCT_IMAGES, ShopService } from './shop.service';
import { ShopBannersService } from './shop-banners.service';
import {
  CreateShopCategoryDto,
  UpdateShopCategoryDto,
} from './dto/category.dto';
import {
  CreateShopProductDto,
  ReorderShopProductImagesDto,
  ReplaceShopProductSpecsDto,
  ReplaceShopProductVariantsDto,
  UpdateShopProductDto,
} from './dto/product.dto';
import { ListShopProductsQueryDto } from './dto/list-products-query.dto';
import {
  MessageResponseDto,
  ShopCategoryResponseDto,
  ShopImportResultDto,
  ShopProductResponseDto,
} from './dto/shop-response.dto';

@ApiTags('Admin Shop Catalog')
@ApiBearerAuth()
@UseGuards(SuperAdminJwtAuthGuard)
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller('admin/shop')
export class ShopController {
  constructor(private readonly shopService: ShopService) {}

  @Get('categories')
  @ApiOperation({ summary: 'List shop categories' })
  @ApiOkResponse({ type: [ShopCategoryResponseDto] })
  listCategories() {
    return this.shopService.listCategories();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a shop category' })
  @ApiOkResponse({ type: ShopCategoryResponseDto })
  createCategory(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: CreateShopCategoryDto,
  ) {
    return this.shopService.createCategory(admin, dto);
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a shop category' })
  @ApiOkResponse({ type: ShopCategoryResponseDto })
  updateCategory(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopCategoryDto,
  ) {
    return this.shopService.updateCategory(admin, id, dto);
  }

  @Delete('categories/:id')
  @ApiOperation({
    summary: 'Delete a shop category',
    description: 'Refused (409) while the category still has products.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  deleteCategory(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.shopService.deleteCategory(admin, id);
  }

  @Get('products')
  @ApiOperation({ summary: 'List shop products' })
  @ApiOkResponse({ type: [ShopProductResponseDto] })
  listProducts(@Query() query: ListShopProductsQueryDto) {
    return this.shopService.listProducts(query);
  }

  // Declared before `products/:id` routes so "export" is never read as an id.
  @Get('products/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header(
    'Content-Disposition',
    'attachment; filename="zomaal-shop-products.csv"',
  )
  @ApiProduces('text/csv')
  @ApiOperation({
    summary: 'Export products as CSV (same filters as the list)',
    description:
      'Columns: name, category, sku, price, stock, status, description',
  })
  exportProducts(@Query() query: ListShopProductsQueryDto) {
    return this.shopService.exportProductsCsv(query);
  }

  @Post('products/import')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description:
            'CSV with a header row. Required: name, category, price. Optional: sku, stock, status (ACTIVE|DRAFT), description. Rows update an existing product matched by SKU (or by exact name when the row has no SKU); others are created. Unknown categories are created. All-or-nothing.',
        },
      },
    },
  })
  @ApiOperation({ summary: 'Import products from CSV' })
  @ApiOkResponse({ type: ShopImportResultDto })
  @ApiBadRequestResponse({
    description: 'Invalid rows — nothing was written.',
    type: ApiErrorDto,
  })
  importProducts(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @UploadedFile() file?: WarehouseMediaUploadFile,
  ) {
    if (!file) throw new BadRequestException('CSV file is required');
    return this.shopService.importProductsCsv(
      admin,
      file.buffer.toString('utf8'),
    );
  }

  @Post('products')
  @ApiOperation({ summary: 'Create a shop product' })
  @ApiOkResponse({ type: ShopProductResponseDto })
  createProduct(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Body() dto: CreateShopProductDto,
  ) {
    return this.shopService.createProduct(admin, dto);
  }

  @Patch('products/:id')
  @ApiOperation({ summary: 'Update a shop product' })
  @ApiOkResponse({ type: ShopProductResponseDto })
  updateProduct(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateShopProductDto,
  ) {
    return this.shopService.updateProduct(admin, id, dto);
  }

  @Delete('products/:id')
  @ApiOperation({ summary: 'Delete a shop product' })
  @ApiOkResponse({ type: MessageResponseDto })
  deleteProduct(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.shopService.deleteProduct(admin, id);
  }

  @Get('products/:id')
  @ApiOperation({
    summary: 'Get one shop product, including its image gallery',
  })
  @ApiOkResponse({ type: ShopProductResponseDto })
  getProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.shopService.getProduct(id);
  }

  @Put('products/:id/variants')
  @ApiOperation({
    summary:
      'Set the product options (size / color, each with its own stock and optional price)',
    description:
      'Replaces the whole list. Product stock becomes the sum of option stock.',
  })
  @ApiOkResponse({ type: ShopProductResponseDto })
  replaceVariants(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceShopProductVariantsDto,
  ) {
    return this.shopService.replaceVariants(admin, id, dto.variants);
  }

  @Put('products/:id/specs')
  @ApiOperation({
    summary: 'Set the Specifications tab rows (replaces the whole list)',
  })
  @ApiOkResponse({ type: ShopProductResponseDto })
  replaceSpecs(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceShopProductSpecsDto,
  ) {
    return this.shopService.replaceSpecs(admin, id, dto.specs);
  }

  @Post('products/:id/images')
  @UseInterceptors(
    FilesInterceptor('images', MAX_PRODUCT_IMAGES, {
      limits: { fileSize: 5 * 1024 * 1024, files: MAX_PRODUCT_IMAGES },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: `One or more JPEG, PNG, or WebP files (max 5 MB each). Appended to the gallery; a product holds up to ${MAX_PRODUCT_IMAGES}. All-or-nothing: if any file is invalid or fails to store, none are added.`,
        },
      },
    },
  })
  @ApiOperation({ summary: "Add images to a product's gallery" })
  @ApiOkResponse({ type: ShopProductResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid file, or the gallery would exceed the limit.',
    type: ApiErrorDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'Image storage is not configured or unreachable.',
    type: ApiErrorDto,
  })
  addImages(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFiles() images: WarehouseMediaUploadFile[] = [],
  ) {
    return this.shopService.addProductImages(admin, id, images);
  }

  @Patch('products/:id/images/order')
  @ApiOperation({
    summary: 'Reorder the gallery — the first image becomes the cover',
  })
  @ApiOkResponse({ type: ShopProductResponseDto })
  reorderImages(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderShopProductImagesDto,
  ) {
    return this.shopService.reorderProductImages(admin, id, dto.imageIds);
  }

  @Delete('products/:id/images/:imageId')
  @ApiOperation({ summary: 'Remove one image from a product gallery' })
  @ApiOkResponse({ type: ShopProductResponseDto })
  removeImage(
    @CurrentSuperAdmin() admin: SuperAdminJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.shopService.removeProductImage(admin, id, imageId);
  }
}

// Public on purpose: an <img> tag can't send a bearer token, and Zomaal Shop
// catalog photos are meant to be seen by merchants anyway. Only serves files
// that belong to a gallery row.
@Controller('shop-media')
export class ShopMediaController {
  constructor(
    private readonly shopService: ShopService,
    private readonly banners: ShopBannersService,
  ) {}

  @Get('images/:imageId')
  @ApiExcludeEndpoint()
  streamImage(
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() response: Response,
  ) {
    return this.shopService.streamImage(imageId, response);
  }

  @Get('banners/:bannerId')
  @ApiExcludeEndpoint()
  streamBanner(
    @Param('bannerId', ParseUUIDPipe) bannerId: string,
    @Res() response: Response,
  ) {
    return this.banners.streamImage(bannerId, response);
  }
}
