import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { PackagingUnit } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export const PACKAGING_MAX_QUANTITY = 1_000_000;

export const PACKAGING_STOCK_STATUSES = [
  'IN_STOCK',
  'LOW_STOCK',
  'OUT_OF_STOCK',
] as const;
export type PackagingStockStatus = (typeof PACKAGING_STOCK_STATUSES)[number];

export const PACKAGING_SOURCES = ['SHOP', 'MANUAL'] as const;
export type PackagingSource = (typeof PACKAGING_SOURCES)[number];

// Update fields that can't be cleared: missing is fine, null is rejected.
const isPresent = (_: unknown, value: unknown) => value !== undefined;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class PackagingListQueryDto {
  @ApiPropertyOptional({ description: 'Matches name or SKU.', maxLength: 100 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ enum: PACKAGING_STOCK_STATUSES })
  @IsOptional()
  @IsIn(PACKAGING_STOCK_STATUSES)
  stockStatus?: PackagingStockStatus;

  @ApiPropertyOptional({
    enum: PACKAGING_SOURCES,
    description:
      'SHOP = bought from Zomaal Shop, MANUAL = added by the merchant.',
  })
  @IsOptional()
  @IsIn(PACKAGING_SOURCES)
  source?: PackagingSource;
}

export class CreatePackagingDto {
  @ApiProperty({ minLength: 1, maxLength: 200, example: 'Medium box' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'BOX-M' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string;

  @ApiPropertyOptional({ enum: PackagingUnit, default: PackagingUnit.PIECES })
  @IsOptional()
  @IsEnum(PackagingUnit)
  unit?: PackagingUnit;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: PACKAGING_MAX_QUANTITY,
    default: 0,
    description: 'Stock on hand when the item is added, in `unit`.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PACKAGING_MAX_QUANTITY)
  openingStock?: number;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: PACKAGING_MAX_QUANTITY,
    default: 0,
    description:
      'Low-stock alert fires when available stock is at or below this.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PACKAGING_MAX_QUANTITY)
  minimumLevel?: number;

  @ApiPropertyOptional({
    default: true,
    description:
      '"Auto Reorder Alert": notify when stock reaches the minimum level.',
  })
  @IsOptional()
  @IsBoolean()
  lowStockAlert?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Upload id from POST /warehouse/media with purpose PACKAGING.',
  })
  @IsOptional()
  @IsUUID()
  imageUploadId?: string;
}

export class UpdatePackagingDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 200,
    description: 'Merchant-added packaging only.',
  })
  @ValidateIf(isPresent)
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    nullable: true,
    type: String,
    description: 'Merchant-added packaging only. null clears it.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @ApiPropertyOptional({ enum: PackagingUnit })
  @ValidateIf(isPresent)
  @IsEnum(PackagingUnit)
  unit?: PackagingUnit;

  @ApiPropertyOptional({ minimum: 0, maximum: PACKAGING_MAX_QUANTITY })
  @ValidateIf(isPresent)
  @IsInt()
  @Min(0)
  @Max(PACKAGING_MAX_QUANTITY)
  minimumLevel?: number;

  @ApiPropertyOptional()
  @ValidateIf(isPresent)
  @IsBoolean()
  lowStockAlert?: boolean;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    type: String,
    description:
      'Merchant-added packaging only. New upload id (purpose PACKAGING) replaces the photo; null removes it.',
  })
  @IsOptional()
  @IsUUID()
  imageUploadId?: string | null;
}
