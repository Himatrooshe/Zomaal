import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
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
    description:
      "Price actually charged for this line. Defaults to the product's stored price when omitted.",
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
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
      'Omit it and every call creates a new order.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey?: string;

  @ApiProperty({ example: 'Ahmed' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  customerName: string;

  @ApiProperty({ example: '+212612345678' })
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  customerPhone: string;

  @ApiProperty({ example: '123 Rue Al Massira, Casablanca' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
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

  @ApiPropertyOptional({ example: 'MAD', default: 'MAD' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({
    example: 0,
    description: 'Shipping fee charged to the customer, if any.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
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
