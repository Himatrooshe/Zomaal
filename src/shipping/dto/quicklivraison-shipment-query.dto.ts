import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class QuickLivraisonShipmentQueryDto {
  @ApiPropertyOptional({
    description:
      'Case-insensitive search across tracking number, merchant reference, recipient, phone, address, and city.',
    example: 'PARCEL_12345678',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: ShippingShipmentStatus,
    description: 'Normalized Zomaal shipment status.',
  })
  @IsOptional()
  @IsEnum(ShippingShipmentStatus)
  status?: ShippingShipmentStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
