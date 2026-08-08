import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  CreateWarehouseProductDto,
  UpdateWarehouseProductDto,
  WarehouseProductQueryDto,
} from './dto/product.dto';
import {
  WarehouseProductListResponseDto,
  WarehouseProductResponseDto,
} from './dto/product-response.dto';
import { ProductService } from './product.service';

@ApiTags('Warehouse Products')
@ApiBearerAuth()
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiUnauthorizedResponse({
  description: 'Bearer token is missing, invalid, or expired.',
  type: ApiErrorDto,
})
@UseGuards(JwtAuthGuard)
@Controller('warehouse/products')
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a complete merchant warehouse product',
    description:
      'Atomic Add Product operation used by the Figma flow. Creates the product, option/value definitions, all variants, one inventory item and barcode per variant, opening balances and movement history, media attachments, optional free gift, and optional packaging requirements. Upload media first. Product status toggle maps to ACTIVE/DRAFT. The client must create and retain a unique idempotencyKey until the request succeeds.',
  })
  @ApiBody({
    type: CreateWarehouseProductDto,
    examples: {
      simpleProduct: {
        summary: 'Simple product; backend generates the barcode',
        value: {
          idempotencyKey: 'mobile-create-product-001',
          name: 'Wireless Headphones',
          description: 'Wireless noise-cancelling headphones.',
          categoryId: '48147007-8231-4702-a15c-62f423992583',
          status: 'ACTIVE',
          mainImageUploadId: '4b0c7fa2-4750-417d-802b-359afad4804c',
          basePrice: 249.99,
          costPrice: 120,
          stockQuantity: 50,
          lowStockAlertThreshold: 5,
          sku: 'HEADPHONE-001',
        },
      },
      variantGiftAndPackaging: {
        summary: 'Variant product with gift and packaging tracking',
        value: {
          idempotencyKey: 'mobile-create-product-002',
          name: 'Premium Cotton T-Shirt',
          description: 'Cotton T-shirt available in multiple sizes.',
          categoryId: '48147007-8231-4702-a15c-62f423992583',
          status: 'ACTIVE',
          mainImageUploadId: '4b0c7fa2-4750-417d-802b-359afad4804c',
          basePrice: 50,
          costPrice: 20,
          stockQuantity: 0,
          lowStockAlertThreshold: 5,
          options: [{ name: 'Size', values: ['M', 'L', 'XL'] }],
          variants: [
            {
              optionValues: ['M'],
              sku: 'TSHIRT-M',
              price: 50,
              stockQuantity: 10,
            },
            {
              optionValues: ['L'],
              sku: 'TSHIRT-L',
              price: 50,
              stockQuantity: 10,
            },
            {
              optionValues: ['XL'],
              sku: 'TSHIRT-XL',
              price: 55,
              stockQuantity: 10,
            },
          ],
          gift: {
            giftVariantId: 'b03ab5df-a184-4f73-a633-20ce08dffdb4',
            quantity: 1,
          },
          packaging: [
            {
              packagingMaterialId: '2d5e2688-0818-429a-bb03-8351130c60ea',
              quantityPerUnit: 1,
            },
          ],
        },
      },
    },
  })
  @ApiCreatedResponse({
    description:
      'Complete created product. An identical idempotent retry returns this same resource.',
    type: WarehouseProductResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'Invalid/expired/reused media, inactive category, invalid gift or packaging reference, invalid barcode, missing/duplicate variant combination, or validation failure.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'Duplicate store SKU/barcode, changed request under an existing idempotency key, or another uniqueness conflict.',
    type: ApiErrorDto,
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWarehouseProductDto,
  ) {
    return this.products.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Search and list merchant warehouse products',
    description:
      'Use this endpoint for the Add Product gift-selection modal. Request status=ACTIVE to return gift-eligible products. Search matches product names and SKUs case-insensitively and barcodes exactly. Archived products are excluded when status is omitted.',
  })
  @ApiOkResponse({ type: WarehouseProductListResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid query value, UUID, status, page, or limit.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The authenticated user has no store.',
    type: ApiErrorDto,
  })
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: WarehouseProductQueryDto,
  ) {
    return this.products.list(user.userId, query);
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Get a complete warehouse product',
    description:
      'Returns everything required to redraw product details: category, ordered options and values, media URLs, variants, barcodes, inventory, gift card data, and packaging requirements.',
  })
  @ApiOkResponse({ type: WarehouseProductResponseDto })
  @ApiBadRequestResponse({
    description: 'Product ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned product was not found.',
    type: ApiErrorDto,
  })
  get(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.get(user.userId, id);
  }

  @Patch(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Update warehouse product metadata safely',
    description:
      'Updates only name, description, category, and status. Send the latest version returned by GET/PATCH; the response increments it. Variant/inventory changes use their dedicated workflows.',
  })
  @ApiOkResponse({ type: WarehouseProductResponseDto })
  @ApiBadRequestResponse({
    description: 'Invalid body, product UUID, or inactive category.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned product was not found.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'The supplied product version is stale.',
    type: ApiErrorDto,
  })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateWarehouseProductDto,
  ) {
    return this.products.update(user.userId, id, dto);
  }

  @Post(':id/archive')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Archive a warehouse product',
    description:
      'Soft-archives the product. Inventory history is preserved and default product lists stop returning it.',
  })
  @ApiCreatedResponse({ type: WarehouseProductResponseDto })
  @ApiBadRequestResponse({
    description: 'Product ID is not a UUID.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned product was not found.',
    type: ApiErrorDto,
  })
  archive(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.archive(user.userId, id);
  }

  @Post(':id/activate')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Activate or restore a warehouse product',
    description:
      'Sets status to ACTIVE and clears archivedAt. The assigned category must still be active.',
  })
  @ApiCreatedResponse({ type: WarehouseProductResponseDto })
  @ApiBadRequestResponse({
    description: 'Product ID is invalid or its category is inactive.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store or store-owned product was not found.',
    type: ApiErrorDto,
  })
  activate(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.products.activate(user.userId, id);
  }
}
