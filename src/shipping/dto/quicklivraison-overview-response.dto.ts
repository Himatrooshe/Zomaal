import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';

class QuickLivraisonOverviewPeriodDto {
  @ApiProperty({ enum: [7, 30, 90] })
  days: number;

  @ApiProperty({ format: 'date-time' })
  from: string;

  @ApiProperty({ format: 'date-time' })
  to: string;

  @ApiProperty({ enum: ['UTC'] })
  timezone: 'UTC';
}

class QuickLivraisonOverviewMetricsDto {
  @ApiProperty() totalShipments: number;
  @ApiProperty() activeShipments: number;
  @ApiProperty() deliveredShipments: number;
  @ApiProperty() returnedShipments: number;
  @ApiProperty() deliveredRate: number;
  @ApiProperty() returnRate: number;
  @ApiPropertyOptional({ nullable: true })
  averageDeliveryDays: number | null;
}

class QuickLivraisonStatusBreakdownDto {
  @ApiProperty({ enum: ShippingShipmentStatus })
  status: ShippingShipmentStatus;
  @ApiProperty() count: number;
}

class QuickLivraisonPerformancePointDto {
  @ApiProperty({ example: '2026-08-13' }) date: string;
  @ApiProperty() shipmentCount: number;
  @ApiProperty() delivered: number;
  @ApiProperty() returned: number;
}

class QuickLivraisonTopCityDto {
  @ApiProperty() city: string;
  @ApiProperty() shipments: number;
  @ApiProperty() delivered: number;
  @ApiProperty() deliveryRate: number;
}

class QuickLivraisonSyncHealthDto {
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  lastSyncedAt: string | null;
  @ApiPropertyOptional({ nullable: true })
  lastSyncError: string | null;
}

export class QuickLivraisonOverviewResponseDto {
  @ApiProperty({ type: QuickLivraisonOverviewPeriodDto })
  period: QuickLivraisonOverviewPeriodDto;
  @ApiProperty({ type: QuickLivraisonOverviewMetricsDto })
  metrics: QuickLivraisonOverviewMetricsDto;
  @ApiProperty({ type: [QuickLivraisonStatusBreakdownDto] })
  statusBreakdown: QuickLivraisonStatusBreakdownDto[];
  @ApiProperty({ type: [QuickLivraisonPerformancePointDto] })
  performance: QuickLivraisonPerformancePointDto[];
  @ApiProperty({ type: [QuickLivraisonTopCityDto] })
  topCities: QuickLivraisonTopCityDto[];
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
  @ApiProperty({ type: QuickLivraisonSyncHealthDto })
  sync: QuickLivraisonSyncHealthDto;
}
