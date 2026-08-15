import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';

class OzoneExpressOverviewPeriodDto {
  @ApiProperty({ enum: [7, 30, 90] }) days: number;
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ enum: ['UTC'] }) timezone: 'UTC';
}

class OzoneExpressOverviewMetricsDto {
  @ApiProperty() totalShipments: number;
  @ApiProperty() activeShipments: number;
  @ApiProperty() deliveredShipments: number;
  @ApiProperty() returnedShipments: number;
  @ApiProperty() deliveredRate: number;
  @ApiProperty() returnRate: number;
  @ApiPropertyOptional({ nullable: true }) averageDeliveryDays: number | null;
}

class OzoneExpressStatusBreakdownDto {
  @ApiProperty({ enum: ShippingShipmentStatus })
  status: ShippingShipmentStatus;
  @ApiProperty() count: number;
}

class OzoneExpressPerformancePointDto {
  @ApiProperty({ example: '2026-08-15' }) date: string;
  @ApiProperty() shipmentCount: number;
  @ApiProperty() delivered: number;
  @ApiProperty() returned: number;
}

class OzoneExpressTopCityDto {
  @ApiProperty() city: string;
  @ApiProperty() shipments: number;
  @ApiProperty() delivered: number;
  @ApiProperty() deliveryRate: number;
}

class OzoneExpressSyncHealthDto {
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncedAt: string | null;
  @ApiPropertyOptional({ nullable: true }) lastSyncError: string | null;
}

export class OzoneExpressOverviewResponseDto {
  @ApiProperty({ type: OzoneExpressOverviewPeriodDto })
  period: OzoneExpressOverviewPeriodDto;
  @ApiProperty({ type: OzoneExpressOverviewMetricsDto })
  metrics: OzoneExpressOverviewMetricsDto;
  @ApiProperty({ type: [OzoneExpressStatusBreakdownDto] })
  statusBreakdown: OzoneExpressStatusBreakdownDto[];
  @ApiProperty({ type: [OzoneExpressPerformancePointDto] })
  performance: OzoneExpressPerformancePointDto[];
  @ApiProperty({ type: [OzoneExpressTopCityDto] })
  topCities: OzoneExpressTopCityDto[];
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
  @ApiProperty({ type: OzoneExpressSyncHealthDto })
  sync: OzoneExpressSyncHealthDto;
}
