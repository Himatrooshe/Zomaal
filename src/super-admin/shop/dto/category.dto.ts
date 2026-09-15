import { ApiPropertyOptional, ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateShopCategoryDto {
  @ApiProperty({
    example: 'Boxes',
    description:
      'Display name. A unique URL-safe slug is generated automatically.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({
    default: 0,
    description: 'Lower positions appear first in the categories list.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateShopCategoryDto extends PartialType(CreateShopCategoryDto) {
  @ApiPropertyOptional({
    description:
      'Inactive categories are hidden from Add Product and cannot be assigned to new or activated products.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
