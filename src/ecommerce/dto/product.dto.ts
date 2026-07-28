import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { EcommercePlatform } from '@prisma/client';

export enum ProductStatus {
  ACTIVE = 'ACTIVE',
  DRAFT = 'DRAFT',
}

export class ProductVariantDto {
  @ApiPropertyOptional({ description: 'Variant title, e.g., "Red / Large"' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  sku?: string;

  @ApiProperty({ description: 'Price' })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ description: 'Original price before discount' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @ApiProperty({ description: 'Inventory quantity' })
  @IsInt()
  @Min(0)
  inventoryQty: number;
}

export class ProductImageDto {
  @ApiProperty({
    description:
      'Provider-hosted image URL returned by POST /ecommerce/products/images/upload',
  })
  @IsUrl()
  url: string;

  @ApiProperty({ description: 'Display order position' })
  @IsInt()
  @Min(0)
  position: number;
}

export class UploadProductImagesDto {
  @ApiProperty({
    enum: EcommercePlatform,
    description:
      'Connected provider that will receive and host the uploaded images',
  })
  @IsEnum(EcommercePlatform)
  platform: EcommercePlatform;
}

export class UploadProductImagesResponseDto {
  @ApiProperty({ enum: EcommercePlatform })
  platform: EcommercePlatform;

  @ApiProperty({ type: [ProductImageDto] })
  images: ProductImageDto[];
}

export class CreateProductDto {
  @ApiProperty({ description: 'Product title' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional({ description: 'HTML or text description' })
  @IsOptional()
  @IsString()
  @MaxLength(100000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  vendor?: string;

  @ApiProperty({ enum: ProductStatus, default: ProductStatus.ACTIVE })
  @IsEnum(ProductStatus)
  status: ProductStatus;

  @ApiProperty({ type: [ProductVariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants: ProductVariantDto[];

  @ApiPropertyOptional({ type: [ProductImageDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];
}

export class ProductListingDto {
  @ApiProperty()
  id: string;

  @ApiPropertyOptional({ nullable: true })
  externalProductId?: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  connectionId: string;

  @ApiProperty({ enum: EcommercePlatform })
  platform: EcommercePlatform;

  @ApiPropertyOptional({ nullable: true })
  errorMessage?: string | null;
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

export class PublishProductDto {
  @ApiProperty({
    enum: EcommercePlatform,
    description: 'Connected e-commerce platform that receives the product',
  })
  @IsEnum(EcommercePlatform)
  platform: EcommercePlatform;

  @ApiProperty({
    description:
      'Client-generated retry key. Reusing it returns or retries the same product instead of creating another one.',
    example: 'product-upload-018f6f4e-8a6d-7d4c-a8e8-5bb69f983c11',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;

  @ApiProperty({ type: CreateProductDto })
  @ValidateNested()
  @Type(() => CreateProductDto)
  product: CreateProductDto;
}
