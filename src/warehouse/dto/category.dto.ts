import { Transform } from 'class-transformer';
import { trimText } from '../../common/calendar-date.util';
import { strictBoolean } from '../../common/query-transform.util';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  ValidateIf,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProductCategoryDto {
  @ApiProperty({
    example: 'Electronics',
    description:
      'Display name. A unique URL-safe slug is generated automatically.',
  })
  @Transform(trimText)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    example: 'Electronic warehouse products',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Optional same-store parent category.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({
    default: 0,
    maximum: 2147483647,
    description: 'Lower positions appear first in the category selector.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(2147483647)
  position?: number;
}

export class UpdateProductCategoryDto extends PartialType(
  CreateProductCategoryDto,
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    description:
      'Inactive categories are hidden from Add Product and cannot be assigned to new or activated products.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsBoolean()
  isActive?: boolean;
}

export class ProductCategoryQueryDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(strictBoolean)
  @IsBoolean()
  includeInactive?: boolean;
}
