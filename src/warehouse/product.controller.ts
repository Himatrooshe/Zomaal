import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
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
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import {
  CompareProductsQueryDto,
  CreateProductBundleDto,
  CreateWarehouseProductDto,
  ProductPerformanceQueryDto,
  UpdateWarehouseProductDto,
  WarehouseProductQueryDto,
} from './dto/product.dto';
import {
  ProductComparisonResponseDto,
  ProductPerformanceResponseDto,
  WarehouseProductListResponseDto,
  WarehouseProductResponseDto,
} from './dto/product-response.dto';
import { ProductComparisonPdfService } from './product-comparison-pdf.service';
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
  constructor(
    private readonly products: ProductService,
    private readonly comparisonPdf: ProductComparisonPdfService,
  ) {}

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

  @Post('bundles')
  @ApiOperation({
    summary: 'Create a product bundle from existing variants',
    description:
      'Creates a sellable bundle with a derived cost and derived stock. Available bundle stock is the minimum number of complete bundles that can be assembled from the selected component variants.',
  })
  @ApiBody({ type: CreateProductBundleDto })
  @ApiCreatedResponse({ type: WarehouseProductResponseDto })
  @ApiBadRequestResponse({
    description:
      'Invalid component, duplicate component, inactive category, or invalid image upload.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description: 'Bundle SKU or idempotency key is already in use.',
    type: ApiErrorDto,
  })
  createBundle(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductBundleDto,
  ) {
    return this.products.createBundle(user.userId, dto);
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

  @Get('compare')
  @ApiOperation({
    summary: 'Compare two store-owned products side by side',
    description:
      'Compare Products screen. Returns matching order/financial metrics for both products over the same 7D, 30D, 90D, or custom period, plus an auto-generated Insight — the single metric with the largest relative gap between the two products.',
  })
  @ApiOkResponse({ type: ProductComparisonResponseDto })
  @ApiBadRequestResponse({
    description: 'productAId equals productBId, or an invalid query value.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store, or either store-owned product, was not found.',
    type: ApiErrorDto,
  })
  compare(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompareProductsQueryDto,
  ) {
    return this.products.compare(user.userId, query);
  }

  @Get('compare/export')
  @ApiOperation({
    summary: 'Export a product comparison as a PDF',
    description:
      'Renders the same comparison returned by GET /warehouse/products/compare as a downloadable PDF report for the "Export Comparison" button.',
  })
  @ApiOkResponse({
    description: 'Binary PDF report.',
    content: {
      'application/pdf': { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ApiBadRequestResponse({
    description: 'productAId equals productBId, or an invalid query value.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'Store, or either store-owned product, was not found.',
    type: ApiErrorDto,
  })
  async exportCompare(
    @CurrentUser() user: JwtPayload,
    @Query() query: CompareProductsQueryDto,
    @Res() response: Response,
  ) {
    const comparison = await this.products.compare(user.userId, query);
    const body = await this.comparisonPdf.render(comparison);
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="product-comparison-${Date.now()}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.send(body);
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

  @Get(':id/performance')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Get product-level order and financial performance',
    description:
      'Returns 7D, 30D, 90D, or custom product performance based on normalized synchronized order lines matched by warehouse SKU.',
  })
  @ApiOkResponse({ type: ProductPerformanceResponseDto })
  performance(
    @CurrentUser() user: JwtPayload,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ProductPerformanceQueryDto,
  ) {
    return this.products.performance(user.userId, id, query);
  }

  @Patch(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'Store-owned warehouse product ID.',
  })
  @ApiOperation({
    summary: 'Update warehouse product details and pricing safely',
    description:
      'Updates name, description, category, status, and simple-product or per-variant price, cost, and low-stock thresholds. Send the latest version returned by GET/PATCH; the response increments it. Stock changes use the dedicated inventory endpoint.',
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

  @Post('backfill-product-codes')
  @ApiOperation({
    summary: 'Backfill Product Tracking Codes for existing variants',
    description:
      'One-time operation. Assigns a Product Tracking Code (e.g. "DH564BJ0") to every ' +
      'existing variant created before this feature shipped — new variants already get ' +
      'one automatically at creation. Idempotent — safe to call multiple times; only ' +
      'touches variants still missing a code.',
  })
  @ApiOkResponse({
    description: 'Backfill result.',
    schema: {
      type: 'object',
      properties: {
        processed: {
          type: 'number',
          description: 'Variants that received a new product code',
        },
        skipped: {
          type: 'number',
          description: 'Variants that failed to backfill',
        },
      },
    },
  })
  backfillProductCodes() {
    return this.products.backfillProductCodes();
  }
}
