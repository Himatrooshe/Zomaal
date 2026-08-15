import { ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class AmeexShipmentQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() search?: string;
  @ApiPropertyOptional({ enum: ShippingShipmentStatus })
  @IsOptional()
  @IsEnum(ShippingShipmentStatus)
  status?: ShippingShipmentStatus;
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AmeexSyncQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;

  @ApiPropertyOptional({
    default: 100,
    minimum: 1,
    maximum: 250,
    description: 'Number of remote Ameex parcels requested per import page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  importPageSize?: number;

  @ApiPropertyOptional({
    default: 10,
    minimum: 1,
    maximum: 50,
    description:
      'Safety cap for remote parcel-list pages imported by one manual sync.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxImportPages?: number;
}
