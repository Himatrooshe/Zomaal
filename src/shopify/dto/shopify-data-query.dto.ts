import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SHOPIFY_DEFAULT_PAGE_SIZE = 20;
export const SHOPIFY_MAX_PAGE_SIZE = 100;

export class ShopifyDataPageQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum number of records to return. Shopify cursor pagination is used instead of page numbers.',
    default: SHOPIFY_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: SHOPIFY_MAX_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SHOPIFY_MAX_PAGE_SIZE)
  first: number = SHOPIFY_DEFAULT_PAGE_SIZE;

  @ApiPropertyOptional({
    description:
      'Opaque `endCursor` returned by the previous response. Omit it for the first page.',
    example: 'eyJsYXN0X2lkIjo2MzIxMzk1MjE5LCJsYXN0X3ZhbHVlIjoiNjMyMTM5NTIxOSJ9',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  after?: string;

  @ApiPropertyOptional({
    description:
      'Optional Shopify search query. Searchable fields and syntax depend on the requested resource.',
    example: 'status:active',
    maxLength: 500,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  query?: string;
}

function trimQueryValue(params: TransformFnParams): unknown {
  const value: unknown = params.value;
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
