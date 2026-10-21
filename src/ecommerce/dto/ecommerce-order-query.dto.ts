import { ApiPropertyOptional } from '@nestjs/swagger';
import { EcommercePaymentStatus, EcommercePlatform } from '@prisma/client';
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

function queryBoolean(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function queryInteger(value: unknown): unknown {
  return typeof value === 'string' &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : value;
}

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
  @Transform(({ value }: { value: unknown }) => queryBoolean(value))
  @IsBoolean()
  includeCancelled?: boolean = false;

  @ApiPropertyOptional({
    description: 'Include refunded orders',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryBoolean(value))
  @IsBoolean()
  includeRefunded?: boolean = false;

  @ApiPropertyOptional({
    description: 'Include orders already dispatched',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryBoolean(value))
  @IsBoolean()
  includeDispatched?: boolean = false;

  @ApiPropertyOptional({
    description: 'Filter by connection revenue inclusion',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryBoolean(value))
  @IsBoolean()
  includeInRevenue?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryInteger(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => queryInteger(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
