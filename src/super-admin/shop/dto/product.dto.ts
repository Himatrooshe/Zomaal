import { ApiPropertyOptional, ApiProperty, PartialType } from '@nestjs/swagger';
import { ShopProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsHexColor,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateShopProductDto {
  @ApiProperty({ example: 'Corrugated Shipping Box' })
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({ example: 'BOX-CORR-01' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({ example: 'Standard 30x20x15cm corrugated box.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 12.0, description: 'Price merchants pay per unit.' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 17.0,
    description:
      'Crossed-out "was" price shown in the app. Only displayed when higher than price. Send null to clear.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  compareAtPrice?: number | null;

  @ApiPropertyOptional({
    default: 'piece',
    example: 'box',
    description: 'What one unit is called ("x100 box").',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unitLabel?: string;

  @ApiPropertyOptional({
    default: false,
    description: 'Pin to the top of Popular items.',
  })
  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @ApiPropertyOptional({
    enum: ShopProductStatus,
    default: ShopProductStatus.DRAFT,
  })
  @IsOptional()
  @IsEnum(ShopProductStatus)
  status?: ShopProductStatus;
}

export class UpdateShopProductDto extends PartialType(CreateShopProductDto) {}

export class ReorderShopProductImagesDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      "Every one of the product's image ids, in the new order. The first becomes the cover.",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsUUID('4', { each: true })
  imageIds: string[];
}

export class ShopProductVariantInputDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Existing option id — omit to create a new option.',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ example: 'XL' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  size?: string;

  @ApiPropertyOptional({ example: 'Brown Kraft' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional({ example: '#8B6B4A' })
  @IsOptional()
  @IsHexColor()
  colorHex?: string;

  @ApiPropertyOptional({ example: 'BOX-XL-KRAFT' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  sku?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Overrides the product price; null = use product price.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  price?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  compareAtPrice?: number | null;

  @ApiProperty({ minimum: 0, example: 120 })
  @IsInt()
  @Min(0)
  stock: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceShopProductVariantsDto {
  @ApiProperty({
    type: [ShopProductVariantInputDto],
    description:
      'The complete option list, in display order. Options not listed are deleted. Send [] to remove all options (stock then comes from the product).',
  })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ShopProductVariantInputDto)
  variants: ShopProductVariantInputDto[];
}

export class ShopProductSpecInputDto {
  @ApiProperty({ example: 'Material' })
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  label: string;

  @ApiProperty({ example: 'ABS Plastic & Aluminum' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  value: string;
}

export class ReplaceShopProductSpecsDto {
  @ApiProperty({
    type: [ShopProductSpecInputDto],
    description: 'The complete Specifications list, in display order.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ShopProductSpecInputDto)
  specs: ShopProductSpecInputDto[];
}
