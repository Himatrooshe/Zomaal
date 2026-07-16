import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ForceLogProductVariantDto {
  @ApiProperty({
    description: 'Variant label (for example size, color, or both).',
    example: 'Black / Medium',
  })
  @IsString()
  NAME: string;

  @ApiProperty({
    description: 'Initial quantity sent to ForceLog stock.',
    example: 20,
    minimum: 0,
  })
  @IsInt()
  QUANTITY: number;

  @ApiPropertyOptional({
    description: 'Unique merchant barcode or SKU for this variant.',
    example: 'TSHIRT-BLK-M',
  })
  @IsOptional()
  @IsString()
  BARCODE?: string;
}

export class ForceLogProductDto {
  @ApiProperty({
    description: 'Display name of the product in ForceLog stock.',
    example: 'Classic cotton T-shirt',
  })
  @IsString()
  PRODUCT_NAME: string;

  @ApiPropertyOptional({
    description:
      'Initial quantity for a product without variants. Do not duplicate variant quantities here.',
    example: 50,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  QUANTITY?: number;

  @ApiPropertyOptional({
    description:
      'Unique merchant barcode or SKU for a product without variants.',
    example: 'TSHIRT-CLASSIC',
  })
  @IsOptional()
  @IsString()
  BARCODE?: string;

  @ApiPropertyOptional({
    description: 'ForceLog stock category identifier.',
    example: 12,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  CATEGORY_ID?: number;

  @ApiPropertyOptional({
    description:
      'Optional product variants. Each variant carries its own quantity and barcode.',
    type: [ForceLogProductVariantDto],
    example: [
      { NAME: 'Black / Medium', QUANTITY: 20, BARCODE: 'TSHIRT-BLK-M' },
      { NAME: 'Black / Large', QUANTITY: 15, BARCODE: 'TSHIRT-BLK-L' },
    ],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ForceLogProductVariantDto)
  VARIANTS?: ForceLogProductVariantDto[];
}
