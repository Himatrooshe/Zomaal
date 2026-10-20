import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryBucket } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
} from 'class-validator';

export class AdjustInventoryDto {
  @ApiProperty({
    enum: InventoryBucket,
    description:
      'Quantity bucket to change: ON_HAND physical stock, RESERVED allocated stock, DAMAGED unusable stock, or INCOMING expected stock.',
  })
  @IsEnum(InventoryBucket)
  bucket: InventoryBucket;

  @ApiProperty({
    description:
      'Non-zero integer. Positive adds to the selected bucket; negative removes from it.',
    example: 10,
  })
  @IsInt()
  @Min(-2147483648)
  @Max(2147483647)
  @NotEquals(0)
  quantityDelta: number;

  @ApiProperty({
    minLength: 3,
    maxLength: 500,
    example: 'Received ten units from supplier',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @ApiProperty({
    minLength: 8,
    maxLength: 100,
    example: 'inventory-adjustment-001',
    description:
      'Retry key unique for this inventory item. Reusing it returns the existing movement without changing stock twice.',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;

  @ApiPropertyOptional({ maxLength: 100, example: 'SUPPLIER_DELIVERY' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceType?: string;

  @ApiPropertyOptional({ maxLength: 255, example: 'DELIVERY-1001' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  referenceId?: string;
}

export class SetInventoryOnHandDto {
  @ApiProperty({
    minimum: 0,
    example: 60,
    description: 'The final on-hand quantity entered in the Update Stock UI.',
  })
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity: number;

  @ApiProperty({ minLength: 3, maxLength: 500, example: 'Manual stock count' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @ApiProperty({ minLength: 8, maxLength: 100 })
  @IsString()
  @MinLength(8)
  @MaxLength(100)
  idempotencyKey: string;
}
