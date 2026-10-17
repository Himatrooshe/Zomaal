import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EcommercePlatform, WarehouseProductStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export enum ProductImportResultStatus {
  IMPORTED = 'IMPORTED',
  ALREADY_IMPORTED = 'ALREADY_IMPORTED',
  SKU_MATCHED = 'SKU_MATCHED',
  FAILED = 'FAILED',
}

export class ImportPlatformProductsDto {
  @ApiProperty({ enum: EcommercePlatform })
  @IsEnum(EcommercePlatform)
  platform: EcommercePlatform;

  @ApiProperty({
    type: [String],
    minItems: 1,
    maxItems: 20,
    description:
      'Platform product IDs as returned by GET /warehouse/products/compare/products for that platform.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(200, { each: true })
  productIds: string[];

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Active category to put the imported products in.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    enum: [WarehouseProductStatus.ACTIVE, WarehouseProductStatus.DRAFT],
    default: WarehouseProductStatus.ACTIVE,
  })
  @IsOptional()
  @IsIn([WarehouseProductStatus.ACTIVE, WarehouseProductStatus.DRAFT])
  status?: WarehouseProductStatus;

  @ApiPropertyOptional({
    default: false,
    description:
      'Use the platform inventory quantity as opening stock (Shopify and YouCan only). Otherwise variants start at 0 and stock is entered in Zomaal.',
  })
  @IsOptional()
  @IsBoolean()
  importStock?: boolean;
}

export class ProductImportResultDto {
  @ApiProperty()
  platformProductId: string;

  @ApiProperty({ enum: ProductImportResultStatus })
  status: ProductImportResultStatus;

  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    description:
      'Created product, or the existing Zomaal product it was matched to.',
  })
  productId: string | null;

  @ApiProperty({ nullable: true, type: String })
  name: string | null;

  @ApiProperty({ description: 'Variants created by this import.' })
  variantsImported: number;

  @ApiProperty({
    description:
      'Imported variants without a platform SKU; their platform orders cannot be linked automatically.',
  })
  variantsWithoutSku: number;

  @ApiProperty({
    description:
      'True when the platform did not provide a purchase cost; cost was set to 0 and should be edited.',
  })
  costMissing: boolean;

  @ApiProperty()
  imageImported: boolean;

  @ApiProperty({ nullable: true, type: String })
  message: string | null;
}

export class ProductImportResponseDto {
  @ApiProperty({ enum: EcommercePlatform })
  platform: EcommercePlatform;

  @ApiProperty()
  imported: number;

  @ApiProperty()
  skipped: number;

  @ApiProperty()
  failed: number;

  @ApiProperty({ type: [ProductImportResultDto] })
  results: ProductImportResultDto[];
}
