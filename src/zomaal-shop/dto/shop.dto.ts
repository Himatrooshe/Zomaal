import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  MerchantPurchaseSource,
  ShopOrderStatus,
  ShopPaymentMethod,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_LINE_QUANTITY } from '../cart.service';

// ---- Catalog ----

export class ListShopProductsDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Case-insensitive match on product name.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ['newest', 'price_asc', 'price_desc', 'name'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'price_asc', 'price_desc', 'name'])
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

// ---- Cart ----

export class AddCartItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  productId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required when the product has options (size/color).',
  })
  @IsOptional()
  @IsUUID()
  variantId?: string;

  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY, example: 20 })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

export class UpdateCartItemDto {
  @ApiProperty({ minimum: 1, maximum: MAX_LINE_QUANTITY })
  @IsInt()
  @Min(1)
  @Max(MAX_LINE_QUANTITY)
  quantity: number;
}

// ---- Addresses ----

export class CreateShopAddressDto {
  @ApiProperty({ example: 'Home' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @ApiProperty({ example: 'Youssef El Amrani' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fullName: string;

  @ApiProperty({ example: '+212600000001' })
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  phone: string;

  @ApiProperty({ example: 'Morocco' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  country: string;

  @ApiProperty({ example: 'Casablanca' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city: string;

  @ApiPropertyOptional({ example: 'Maarif' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  district?: string;

  @ApiProperty({ example: '12 Rue Abou Bakr, Apt 4' })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  address: string;

  @ApiPropertyOptional({
    description: 'The first address is always the default.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateShopAddressDto extends PartialType(CreateShopAddressDto) {}

// ---- Checkout / orders ----

export class CheckoutPreviewDto {
  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoCode?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Defaults to the default address.',
  })
  @IsOptional()
  @IsUUID()
  addressId?: string;
}

export class PlaceShopOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  addressId: string;

  @ApiProperty({
    enum: ShopPaymentMethod,
    description: 'Only COD is accepted for now.',
  })
  @IsEnum(ShopPaymentMethod)
  paymentMethod: ShopPaymentMethod;

  @ApiPropertyOptional({ example: 'WELCOME10' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  promoCode?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListShopOrdersDto {
  @ApiPropertyOptional({ enum: ShopOrderStatus })
  @IsOptional()
  @IsEnum(ShopOrderStatus)
  status?: ShopOrderStatus;
}

export class CancelShopOrderDto {
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}

// ---- Purchases ----

export class ListPurchasesDto {
  @ApiPropertyOptional({
    enum: MerchantPurchaseSource,
    description: 'Omit for All; MANUAL or SHOP ("From Shop").',
  })
  @IsOptional()
  @IsEnum(MerchantPurchaseSource)
  source?: MerchantPurchaseSource;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreatePurchaseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'One of your own warehouse products (Select Product).',
  })
  @IsUUID()
  warehouseProductId: string;

  @ApiProperty({ minimum: 1, example: 100 })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity: number;

  @ApiProperty({
    minimum: 0,
    example: 12.5,
    description: 'Unit purchase price. Total cost = quantity × unit price.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice: number;

  @ApiProperty({
    example: '2026-04-20',
    description: 'ISO date; can’t be in the future.',
  })
  @IsDateString()
  purchaseDate: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdatePurchaseDto {
  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  purchaseDate?: string;

  @ApiPropertyOptional({ maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class PurchaseProductOptionsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
