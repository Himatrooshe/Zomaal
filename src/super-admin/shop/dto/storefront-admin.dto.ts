import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  ShopBannerLinkType,
  ShopOrderStatus,
  ShopPromoType,
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
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// ---- Banners ----

export class CreateShopBannerDto {
  @ApiPropertyOptional({ example: 'New: kraft mailer boxes' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @ApiPropertyOptional({ example: '10% off this week' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  subtitle?: string;

  @ApiPropertyOptional({
    enum: ShopBannerLinkType,
    default: ShopBannerLinkType.NONE,
  })
  @IsOptional()
  @IsEnum(ShopBannerLinkType)
  linkType?: ShopBannerLinkType;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Product or category id when linkType is PRODUCT/CATEGORY.',
  })
  @IsOptional()
  @IsUUID()
  linkId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class UpdateShopBannerDto extends PartialType(CreateShopBannerDto) {}

// ---- Promo codes ----

export class CreateShopPromoCodeDto {
  @ApiProperty({
    example: 'WELCOME10',
    description: 'Letters, digits, - and _. Stored uppercase.',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, {
    message: 'code must be 3–40 letters, digits, - or _',
  })
  code: string;

  @ApiPropertyOptional({ example: '10% off your first order' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @ApiProperty({ enum: ShopPromoType })
  @IsEnum(ShopPromoType)
  type: ShopPromoType;

  @ApiProperty({
    example: 10,
    description: 'Percent (1–100) or a fixed amount.',
  })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.01)
  value: number;

  @ApiPropertyOptional({ nullable: true, example: 200 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minSubtotal?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 100,
    description: 'Cap for PERCENT codes.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  maxDiscount?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Total uses across all merchants.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  usageLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Uses per merchant.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  perStoreLimit?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateShopPromoCodeDto extends PartialType(
  CreateShopPromoCodeDto,
) {}

// ---- Settings ----

export class UpdateShopSettingsDto {
  @ApiPropertyOptional({ example: 'MAD' })
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  deliveryFee?: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 500,
    description:
      'Delivery is free at or above this subtotal. null = never free.',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  freeDeliveryMinSubtotal?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  codEnabled?: boolean;

  @ApiPropertyOptional({
    example: 3,
    description: '0 disables the restriction.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  codCancellationLimit?: number;

  @ApiPropertyOptional({ example: 90 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  codCancellationWindowDays?: number;
}

// ---- Orders ----

export class AdminListShopOrdersDto {
  @ApiPropertyOptional({ enum: ShopOrderStatus })
  @IsOptional()
  @IsEnum(ShopOrderStatus)
  status?: ShopOrderStatus;

  @ApiPropertyOptional({
    description: 'Order number (ZS-1001 or 1001), merchant name, or phone.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  storeId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

export class AdvanceShopOrderDto {
  @ApiProperty({
    enum: [
      ShopOrderStatus.CONFIRMED,
      ShopOrderStatus.SHIPPED,
      ShopOrderStatus.DELIVERED,
    ],
  })
  @IsIn([
    ShopOrderStatus.CONFIRMED,
    ShopOrderStatus.SHIPPED,
    ShopOrderStatus.DELIVERED,
  ])
  status: ShopOrderStatus;

  @ApiPropertyOptional({ maxLength: 80 })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  trackingNumber?: string;
}

export class AdminCancelShopOrderDto {
  @ApiProperty({ example: 'Merchant unreachable', minLength: 3 })
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason: string;
}

export class UpdateShopOrderNoteDto {
  @ApiProperty({ nullable: true, maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string | null;
}
