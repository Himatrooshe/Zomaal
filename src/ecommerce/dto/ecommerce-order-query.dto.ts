import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  EcommercePaymentStatus,
  EcommercePlatform,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class EcommerceOrderQueryDto {
  @ApiPropertyOptional({ enum: EcommercePlatform })
  @IsOptional()
  @IsEnum(EcommercePlatform)
  platform?: EcommercePlatform;

  @ApiPropertyOptional({ description: 'Search by order ID or name' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: EcommercePaymentStatus })
  @IsOptional()
  @IsEnum(EcommercePaymentStatus)
  financialStatus?: EcommercePaymentStatus;

  @ApiPropertyOptional({
    description: 'Fulfillment status (e.g., unfulfilled)',
  })
  @IsOptional()
  @IsString()
  fulfillmentStatus?: string;

  @ApiPropertyOptional({
    description: 'Include cancelled orders',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeCancelled?: boolean = false;

  @ApiPropertyOptional({
    description: 'Include refunded orders',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeRefunded?: boolean = false;

  @ApiPropertyOptional({
    description: 'Include orders already dispatched',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDispatched?: boolean = false;

  @ApiPropertyOptional({
    description: 'Filter by connection revenue inclusion',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInRevenue?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
