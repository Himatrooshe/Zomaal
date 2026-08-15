import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';

class ForceLogOverviewPeriodDto {
  @ApiProperty({ enum: [7, 30, 90] }) days: number;
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ enum: ['UTC'] }) timezone: 'UTC';
}

class ForceLogOverviewMetricsDto {
  @ApiProperty() totalShipments: number;
  @ApiProperty() activeShipments: number;
  @ApiProperty() deliveredShipments: number;
  @ApiProperty() returnedShipments: number;
  @ApiProperty() deliveredRate: number;
  @ApiProperty() returnRate: number;
  @ApiPropertyOptional({ nullable: true }) averageDeliveryDays: number | null;
}

class ForceLogStatusBreakdownDto {
  @ApiProperty({ enum: ShippingShipmentStatus })
  status: ShippingShipmentStatus;
  @ApiProperty() count: number;
}

class ForceLogPerformancePointDto {
  @ApiProperty({ example: '2026-08-15' }) date: string;
  @ApiProperty() shipmentCount: number;
  @ApiProperty() delivered: number;
  @ApiProperty() returned: number;
}

class ForceLogTopCityDto {
  @ApiProperty() city: string;
  @ApiProperty() shipments: number;
  @ApiProperty() delivered: number;
  @ApiProperty() deliveryRate: number;
}

class ForceLogSyncHealthDto {
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncError: string | null;
}

export class ForceLogOverviewResponseDto {
  @ApiProperty({ type: ForceLogOverviewPeriodDto })
  period: ForceLogOverviewPeriodDto;
  @ApiProperty({ type: ForceLogOverviewMetricsDto })
  metrics: ForceLogOverviewMetricsDto;
  @ApiProperty({ type: [ForceLogStatusBreakdownDto] })
  statusBreakdown: ForceLogStatusBreakdownDto[];
  @ApiProperty({ type: [ForceLogPerformancePointDto] })
  performance: ForceLogPerformancePointDto[];
  @ApiProperty({ type: [ForceLogTopCityDto] })
  topCities: ForceLogTopCityDto[];
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
  @ApiProperty({ type: ForceLogSyncHealthDto }) sync: ForceLogSyncHealthDto;
}
