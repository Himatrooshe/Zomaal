import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  PRODUCT_CONDITIONS,
  ProductCondition,
} from '../constants/product-condition';

export class RecordProductConditionDto {
  @ApiProperty({
    example: 'DH564BJ0',
    description: "Must match a product code on one of this order's lines.",
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productCode: string;

  @ApiProperty({ enum: PRODUCT_CONDITIONS, example: ProductCondition.DAMAGED })
  @IsIn(PRODUCT_CONDITIONS)
  condition: ProductCondition;

  @ApiPropertyOptional({
    example: 120,
    description:
      'Only meaningful when condition is DAMAGED; ignored (stored as null) for every other condition.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  damageCost?: number;

  @ApiPropertyOptional({ example: 'Tear on left sleeve' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
