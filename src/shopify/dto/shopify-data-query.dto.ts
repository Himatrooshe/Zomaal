import { Transform, Type, type TransformFnParams } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SHOPIFY_DEFAULT_PAGE_SIZE = 20;
export const SHOPIFY_MAX_PAGE_SIZE = 100;
export const SHOPIFY_DEFAULT_PRODUCT_VARIANTS_PAGE_SIZE = 50;
export const SHOPIFY_DEFAULT_PRODUCT_MEDIA_PAGE_SIZE = 20;
export const SHOPIFY_MAX_PRODUCT_MEDIA_PAGE_SIZE = 50;
export const SHOPIFY_DEFAULT_ORDER_LINE_ITEMS_PAGE_SIZE = 50;
export const SHOPIFY_DEFAULT_ORDER_FULFILLMENTS_PAGE_SIZE = 20;
export const SHOPIFY_MAX_ORDER_FULFILLMENTS_PAGE_SIZE = 50;

export class ShopifyProductIdParamDto {
  @ApiProperty({
    description:
      'Numeric Shopify product ID. Use the numeric suffix from `gid://shopify/Product/<id>` returned by the product list.',
    example: '9172411547890',
    pattern: '^[1-9]\\d{0,19}$',
  })
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/, {
    message: 'productId must be a positive numeric Shopify product ID',
  })
  productId!: string;
}

export class ShopifyOrderIdParamDto {
  @ApiProperty({
    description:
      'Numeric Shopify order ID. Use the numeric suffix from `gid://shopify/Order/<id>` returned by the order list.',
    example: '6632134869234',
    pattern: '^[1-9]\\d{0,19}$',
  })
  @IsString()
  @Matches(/^[1-9]\d{0,19}$/, {
    message: 'orderId must be a positive numeric Shopify order ID',
  })
  orderId!: string;
}

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

export class ShopifyProductDetailsQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum variants to return in this response. Use `variants.pageInfo.endCursor` with `variantsAfter` for the next page.',
    default: SHOPIFY_DEFAULT_PRODUCT_VARIANTS_PAGE_SIZE,
    minimum: 1,
    maximum: SHOPIFY_MAX_PAGE_SIZE,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SHOPIFY_MAX_PAGE_SIZE)
  variantsFirst: number = SHOPIFY_DEFAULT_PRODUCT_VARIANTS_PAGE_SIZE;

  @ApiPropertyOptional({
    description:
      'Opaque variant cursor returned in `variants.pageInfo.endCursor`.',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  variantsAfter?: string;

  @ApiPropertyOptional({
    description:
      'Maximum product media items to return. Use `media.pageInfo.endCursor` with `mediaAfter` for the next page.',
    default: SHOPIFY_DEFAULT_PRODUCT_MEDIA_PAGE_SIZE,
    minimum: 1,
    maximum: SHOPIFY_MAX_PRODUCT_MEDIA_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SHOPIFY_MAX_PRODUCT_MEDIA_PAGE_SIZE)
  mediaFirst: number = SHOPIFY_DEFAULT_PRODUCT_MEDIA_PAGE_SIZE;

  @ApiPropertyOptional({
    description: 'Opaque media cursor returned in `media.pageInfo.endCursor`.',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  mediaAfter?: string;
}

export class ShopifyOrderDetailsQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum line items to return. Use `lineItems.pageInfo.endCursor` with `lineItemsAfter` for the next page.',
    default: SHOPIFY_DEFAULT_ORDER_LINE_ITEMS_PAGE_SIZE,
    minimum: 1,
    maximum: SHOPIFY_MAX_PAGE_SIZE,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SHOPIFY_MAX_PAGE_SIZE)
  lineItemsFirst: number = SHOPIFY_DEFAULT_ORDER_LINE_ITEMS_PAGE_SIZE;

  @ApiPropertyOptional({
    description:
      'Opaque line-item cursor returned in `lineItems.pageInfo.endCursor`.',
    maxLength: 2048,
  })
  @IsOptional()
  @Transform(trimQueryValue)
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  lineItemsAfter?: string;

  @ApiPropertyOptional({
    description: 'Maximum fulfillments to include in this response.',
    default: SHOPIFY_DEFAULT_ORDER_FULFILLMENTS_PAGE_SIZE,
    minimum: 1,
    maximum: SHOPIFY_MAX_ORDER_FULFILLMENTS_PAGE_SIZE,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SHOPIFY_MAX_ORDER_FULFILLMENTS_PAGE_SIZE)
  fulfillmentsFirst: number = SHOPIFY_DEFAULT_ORDER_FULFILLMENTS_PAGE_SIZE;
}

function trimQueryValue(params: TransformFnParams): unknown {
  const value: unknown = params.value;
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
