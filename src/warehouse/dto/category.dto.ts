import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({
    example: 'Electronics',
    description:
      'Display name. A unique URL-safe slug is generated automatically.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: 'Electronic warehouse products' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional same-store parent category.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Lower positions appear first in the category selector.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateProductCategoryDto extends PartialType(
  CreateProductCategoryDto,
) {
  @ApiPropertyOptional({
    description:
      'Inactive categories are hidden from Add Product and cannot be assigned to new or activated products.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
