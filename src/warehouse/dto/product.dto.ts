import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryBarcodeType, WarehouseProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProductOptionInputDto {
  @ApiProperty({
    description:
      'Display name of the option. Names are case-insensitively unique.',
    example: 'Size',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name: string;

  @ApiProperty({
    description:
      'Ordered values shown in the UI. Values are case-insensitively unique within the option.',
    example: ['M', 'L', 'XL'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  values: string[];
}

export class ProductVariantInputDto {
  @ApiProperty({
    type: [String],
    description: 'Values in the same order as the product options.',
    example: ['M', 'Black'],
  })
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  optionValues: string[];

  @ApiPropertyOptional({
    description:
      'Optional merchant SKU; unique across the authenticated store.',
    example: 'TSHIRT-M-BLACK',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Physical product barcode. A unique internal Code 128 value is generated when omitted.',
    example: 'SUPPLIER-TSHIRT-M-BLACK',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({
    enum: InventoryBarcodeType,
    description:
      'Omit when barcode is omitted. OTHER accepts merchant-specific codes.',
  })
  @IsOptional()
  @IsEnum(InventoryBarcodeType)
  barcodeType?: InventoryBarcodeType;

  @ApiProperty({
    example: 50,
    description: 'Retail price for this exact variant.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 20,
    description: 'Uses the product-level costPrice when omitted.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice?: number;

  @ApiProperty({
    example: 10,
    description: 'Opening on-hand balance for this exact variant.',
  })
  @IsInt()
  @Min(0)
  stockQuantity: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 5,
    description: 'Uses the product-level threshold when omitted.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockAlertThreshold?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'ID returned by POST /warehouse/media with purpose VARIANT. An upload ID can be attached only once.',
  })
  @IsOptional()
  @IsUUID()
  imageUploadId?: string;
}

export class ProductGiftInputDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Active variant belonging to another product in the same merchant store.',
  })
  @IsUUID()
  giftVariantId: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quantity?: number;
}

export class ProductPackagingInputDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Owned material ID returned by GET /warehouse/packaging. A material can appear only once.',
  })
  @IsUUID()
  packagingMaterialId: string;

  @ApiProperty({
    minimum: 1,
    maximum: 1000,
    example: 1,
    description:
      'Units of this packaging material consumed per delivered product.',
  })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantityPerUnit: number;
}

export class CreateWarehouseProductDto {
  @ApiProperty({
    minLength: 8,
    maxLength: 100,
    example: 'mobile-create-018f8d5a',
    description:
      'Client-generated retry key. Resending the identical request returns the existing product; reusing it for changed data returns 409.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;

  @ApiProperty({ example: 'Premium Cotton T-Shirt' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'Cotton T-shirt with size and colour options.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  description?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Active category returned by GET /warehouse/categories.',
  })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({
    enum: WarehouseProductStatus,
    default: 'ACTIVE',
    description:
      'Map the design status toggle to ACTIVE when on and DRAFT when off. Archive later with the archive endpoint.',
  })
  @IsOptional()
  @IsEnum(WarehouseProductStatus)
  status?: WarehouseProductStatus;

  @ApiProperty({
    format: 'uuid',
    description:
      'ID returned by POST /warehouse/media with purpose PRODUCT_MAIN. Required and single-use.',
  })
  @IsUUID()
  mainImageUploadId: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: 4,
    description:
      'Unique IDs returned by POST /warehouse/media with purpose PRODUCT_GALLERY.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsUUID('4', { each: true })
  galleryImageUploadIds?: string[];

  @ApiProperty({
    example: 50,
    description:
      'Price for a product without options. With options, each variant price is authoritative.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  basePrice: number;

  @ApiProperty({
    example: 20,
    description:
      'Cost for a product without options and fallback cost for variants that omit costPrice.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  costPrice: number;

  @ApiProperty({
    example: 10,
    description:
      'Opening stock for a product without options. With options, each variant stockQuantity is authoritative.',
  })
  @IsInt()
  @Min(0)
  stockQuantity: number;

  @ApiPropertyOptional({
    minimum: 0,
    default: 5,
    description: 'Default threshold and fallback for variants.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockAlertThreshold?: number;

  @ApiPropertyOptional({
    description:
      'SKU for a product without options. Supply SKU per variant when options are present.',
    example: 'TSHIRT-DEFAULT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({
    description:
      'Barcode for a product without options. Generated when omitted. Supply barcode per variant when options are present.',
    example: 'SUPPLIER-ITEM-001',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  barcode?: string;

  @ApiPropertyOptional({
    enum: InventoryBarcodeType,
    description: 'Barcode type for the product-without-options barcode.',
  })
  @IsOptional()
  @IsEnum(InventoryBarcodeType)
  barcodeType?: InventoryBarcodeType;

  @ApiPropertyOptional({
    type: [ProductOptionInputDto],
    maxItems: 3,
    description:
      'Omit for a simple product. When present, variants must contain every Cartesian combination exactly once.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionInputDto)
  options?: ProductOptionInputDto[];

  @ApiPropertyOptional({
    type: [ProductVariantInputDto],
    maxItems: 100,
    description:
      'Required when options are present and forbidden for a simple product.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInputDto)
  variants?: ProductVariantInputDto[];

  @ApiPropertyOptional({
    type: ProductGiftInputDto,
    description: 'Omit when Enable Gift is off.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ProductGiftInputDto)
  gift?: ProductGiftInputDto;

  @ApiPropertyOptional({
    type: [ProductPackagingInputDto],
    description: 'Omit or send an empty array when packaging tracking is off.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductPackagingInputDto)
  packaging?: ProductPackagingInputDto[];
}

export class UpdateWarehouseProductDto {
  @ApiProperty({
    description:
      'Current version from the latest product response. A stale version returns 409.',
    example: 1,
  })
  @IsInt()
  @Min(1)
  version: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  description?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: WarehouseProductStatus })
  @IsOptional()
  @IsEnum(WarehouseProductStatus)
  status?: WarehouseProductStatus;
}

export enum ProductStockStatus {
  /** Product has more available units than its low-stock threshold. */
  IN_STOCK = 'IN_STOCK',
  /** Product has 1..threshold available units. */
  LOW_STOCK = 'LOW_STOCK',
  /** Product has 0 available units (including products without inventory). */
  OUT_OF_STOCK = 'OUT_OF_STOCK',
}

export class WarehouseProductQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive product-name or SKU search; barcode matching is exact.',
    example: 'Headphones',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: WarehouseProductStatus })
  @IsOptional()
  @IsEnum(WarehouseProductStatus)
  status?: WarehouseProductStatus;

  @ApiPropertyOptional({
    enum: ProductStockStatus,
    description:
      'Stock availability filter. Available = onHand - reserved - damaged summed across variants; low-stock threshold is the sum of the variants lowStockAlertThreshold.',
  })
  @IsOptional()
  @IsEnum(ProductStockStatus)
  stockStatus?: ProductStockStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
