import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';

export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
}

export class ProductVariantDto {
  @ApiPropertyOptional({ description: 'Variant title, e.g., "Red / Large"' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sku?: string;

  @ApiProperty({ description: 'Price' })
  @IsNumber()
  price: number;

  @ApiPropertyOptional({ description: 'Original price before discount' })
  @IsOptional()
  @IsNumber()
  compareAtPrice?: number;

  @ApiProperty({ description: 'Inventory quantity' })
  @IsNumber()
  inventoryQty: number;
}

export class ProductImageDto {
  @ApiProperty({ description: 'Public URL to the image' })
  @IsUrl()
  url: string;

  @ApiProperty({ description: 'Display order position' })
  @IsNumber()
  position: number;
}

export class CreateProductDto {
  @ApiProperty({ description: 'Product title' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'HTML or text description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendor?: string;

  @ApiProperty({ enum: ProductStatus, default: ProductStatus.ACTIVE })
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @ApiProperty({ type: [ProductVariantDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants: ProductVariantDto[];

  @ApiPropertyOptional({ type: [ProductImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class ProductListingDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  externalProductId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  connectionId: string;
}

export class ProductResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  vendor?: string;

  @ApiProperty()
  status: string;

  @ApiProperty({ type: [ProductVariantDto] })
  variants: ProductVariantDto[];

  @ApiProperty({ type: [ProductImageDto] })
  images: ProductImageDto[];

  @ApiProperty({ type: [ProductListingDto] })
  listings: ProductListingDto[];
}
