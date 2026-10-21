import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { MAX_MONEY_INPUT } from '../../common/persisted-money';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO4217CurrencyCode,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ManualOrderItemDto {
  @ApiProperty({
    example: 'DH564BJ0',
    description: 'Must match an existing warehouse product/variant code.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  productCode: string;

  @ApiProperty({ minimum: 1, maximum: 1000, example: 2 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

  @ApiPropertyOptional({
    example: 300,
    minimum: 0,
    maximum: MAX_MONEY_INPUT,
    multipleOf: 0.0001,
    description:
      "Price actually charged for this line. Defaults to the product's stored price when omitted.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONEY_INPUT)
  unitPrice?: number;
}

export class CreateManualOrderDto {
  @ApiPropertyOptional({
    minLength: 8,
    maxLength: 100,
    example: 'whatsapp-msg-018f8d5a',
    description:
      'Optional client-generated retry key. Resending the identical request ' +
      'with the same key returns the existing order instead of creating a ' +
      'duplicate — protects against double-submit on a flaky connection. ' +
      'Reusing the key with different customer, shipping or item data returns 409. ' +
      'Omit it and every call creates a new order.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiProperty({ example: 'Ahmed', pattern: '\\S' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: 'customerName must not be blank' })
  customerName: string;

  @ApiProperty({ example: '+212612345678', pattern: '\\S' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  @Matches(/\S/, { message: 'customerPhone must not be blank' })
  customerPhone: string;

  @ApiProperty({ example: '123 Rue Al Massira, Casablanca', pattern: '\\S' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @Matches(/\S/, { message: 'shippingAddress must not be blank' })
  shippingAddress: string;

  @ApiPropertyOptional({ example: 'Casablanca' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingCity?: string;

  @ApiPropertyOptional({ example: 'Morocco' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  shippingCountry?: string;

  @ApiPropertyOptional({ example: 'Call before delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({
    example: 'MAD',
    description:
      'Official ISO 4217 currency code. Case insensitive; defaults to the store currency.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @IsString()
  @IsISO4217CurrencyCode()
  currency?: string;

  @ApiPropertyOptional({
    example: 0,
    minimum: 0,
    maximum: MAX_MONEY_INPUT,
    multipleOf: 0.0001,
    description: 'Shipping fee charged to the customer, if any.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(MAX_MONEY_INPUT)
  shippingCost?: number;

  @ApiProperty({
    type: [ManualOrderItemDto],
    minItems: 1,
    maxItems: 100,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ManualOrderItemDto)
  items: ManualOrderItemDto[];
}
