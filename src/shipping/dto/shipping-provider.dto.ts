import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum ShippingProvider {
  SENDIT = 'sendit',
  QUICKLIVRAISON = 'quicklivraison',
  FORCELOG = 'forcelog',
  OZONEEXPRESS = 'ozoneexpress',
  AMEEX = 'ameex',
}

export class SharedShipmentQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

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

export class SharedOverviewQueryDto {
  @ApiPropertyOptional({ enum: [7, 30, 90], default: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([7, 30, 90])
  days?: 7 | 30 | 90;
}

export class SharedSyncQueryDto {
  @ApiPropertyOptional({
    description:
      'Maximum active shipments to refresh. Ameex is capped at 25 by its provider API.',
    default: 20,
    minimum: 1,
    maximum: 25,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(25)
  limit?: number;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  startPage?: number;

  @ApiPropertyOptional({ default: 5, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxPages?: number;

  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 250 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(250)
  importPageSize?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  maxImportPages?: number;
}

export class SharedPaginationDto {
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
  @ApiProperty() totalPages: number;
}

export class SharedShipmentDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty() providerCode: string;
  @ApiProperty() providerStatus: string;
  @ApiPropertyOptional({ nullable: true }) providerSubStatus: string | null;
  @ApiProperty({ enum: ShippingShipmentStatus })
  normalizedStatus: ShippingShipmentStatus;
  @ApiPropertyOptional({ nullable: true }) reference: string | null;
  @ApiPropertyOptional({ nullable: true }) recipientName: string | null;
  @ApiPropertyOptional({ nullable: true }) recipientPhone: string | null;
  @ApiPropertyOptional({ nullable: true }) address: string | null;
  @ApiPropertyOptional({ nullable: true }) city: string | null;
  @ApiPropertyOptional({ nullable: true }) cityId: number | null;
  @ApiPropertyOptional({ nullable: true }) codAmount: string | null;
  @ApiPropertyOptional({ nullable: true }) fee: string | null;
  @ApiProperty() currency: string;
  @ApiPropertyOptional({ nullable: true }) productName: string | null;
  @ApiPropertyOptional({ nullable: true }) note: string | null;
  @ApiPropertyOptional({ nullable: true }) lastActionAt: string | null;
  @ApiPropertyOptional({ nullable: true }) providerCreatedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) providerUpdatedAt: string | null;
  @ApiProperty() createdAt: string;
  @ApiProperty() updatedAt: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  providerDetails: Record<string, unknown>;
}

export class SharedShipmentListDto {
  @ApiProperty({ type: [SharedShipmentDto] }) data: SharedShipmentDto[];
  @ApiProperty({ type: SharedPaginationDto }) pagination: SharedPaginationDto;
}

export class SharedTrackingEventDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty() eventType: string;
  @ApiProperty() providerStatus: string;
  @ApiPropertyOptional({ nullable: true }) providerSubStatus: string | null;
  @ApiProperty({ enum: ShippingShipmentStatus })
  normalizedStatus: ShippingShipmentStatus;
  @ApiPropertyOptional({ nullable: true }) statusName: string | null;
  @ApiPropertyOptional({ nullable: true }) statusColor: string | null;
  @ApiPropertyOptional({ nullable: true }) message: string | null;
  @ApiPropertyOptional({ nullable: true }) actor: string | null;
  @ApiPropertyOptional({ nullable: true }) proofImageUrl: string | null;
  @ApiProperty() eventAt: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  providerDetails: Record<string, unknown>;
}

export class SharedShipmentDetailDto extends SharedShipmentDto {
  @ApiProperty({ type: [SharedTrackingEventDto] })
  events: SharedTrackingEventDto[];
}

export class SharedTimelineDto {
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty() providerCode: string;
  @ApiProperty() providerStatus: string;
  @ApiPropertyOptional({ nullable: true }) providerSubStatus: string | null;
  @ApiProperty({ enum: ShippingShipmentStatus })
  normalizedStatus: ShippingShipmentStatus;
  @ApiPropertyOptional({ nullable: true }) lastActionAt: string | null;
  @ApiProperty({ type: [SharedTrackingEventDto] })
  events: SharedTrackingEventDto[];
}

export class SharedConnectionStatusDto {
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty() connected: boolean;
  @ApiPropertyOptional({ nullable: true }) connectedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncError: string | null;
  @ApiPropertyOptional({ nullable: true }) message: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  providerDetails: Record<string, unknown>;
}

export class SharedSyncResultDto {
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ nullable: true }) message: string | null;
  @ApiPropertyOptional({ nullable: true }) syncedAt: string | null;
  @ApiProperty() selected: number;
  @ApiProperty() processed: number;
  @ApiProperty() imported: number;
  @ApiProperty() refreshed: number;
  @ApiProperty() reconciled: number;
  @ApiProperty() failed: number;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  failures: unknown[];
  @ApiPropertyOptional({ nullable: true }) nextCursor: string | number | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  providerDetails: Record<string, unknown>;
}

export class SharedOverviewResponseDto {
  @ApiProperty({ enum: ShippingProvider }) provider: ShippingProvider;
  @ApiProperty({ type: 'object', additionalProperties: true })
  period: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true })
  metrics: Record<string, unknown>;
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  statusBreakdown: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  performance: unknown[];
  @ApiProperty({ type: 'array', items: { type: 'object' } })
  topCities: unknown[];
  @ApiPropertyOptional({ nullable: true }) dataUpdatedAt: string | null;
  @ApiProperty({ type: 'object', additionalProperties: true })
  sync: Record<string, unknown>;
}
