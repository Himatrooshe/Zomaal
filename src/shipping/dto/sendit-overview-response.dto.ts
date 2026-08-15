import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ShippingShipmentStatus } from '@prisma/client';

export class SenditOverviewPeriodDto {
  @ApiProperty({ enum: [7, 30, 90], example: 7 })
  days: number;

  @ApiProperty({ format: 'date-time' })
  from: string;

  @ApiProperty({ format: 'date-time' })
  to: string;

  @ApiProperty({ enum: ['UTC'], example: 'UTC' })
  timezone: 'UTC';
}

export class SenditOverviewMetricsDto {
  @ApiProperty({ example: 1842 })
  totalShipments: number;

  @ApiProperty({ example: 120 })
  activeShipments: number;

  @ApiProperty({ example: 1510 })
  deliveredShipments: number;

  @ApiProperty({ example: 46 })
  returnedShipments: number;

  @ApiProperty({
    description:
      'Delivered shipments divided by resolved shipments (delivered, cancelled, refused, or in a return state).',
    example: 94.38,
  })
  deliveredRate: number;

  @ApiProperty({
    description:
      'Shipments currently in a normalized return state divided by all shipments.',
    example: 2.5,
  })
  returnRate: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Average elapsed days from provider creation to the first delivered timeline event.',
    example: 2.3,
  })
  averageDeliveryDays: number | null;
}

export class SenditStatusBreakdownItemDto {
  @ApiProperty({ enum: ShippingShipmentStatus })
  status: ShippingShipmentStatus;

  @ApiProperty({ example: 120 })
  count: number;
}

export class SenditPerformancePointDto {
  @ApiProperty({ example: '2026-08-13' })
  date: string;

  @ApiProperty({ example: 18 })
  shipmentCount: number;

  @ApiProperty({ example: 14 })
  delivered: number;

  @ApiProperty({ example: 2 })
  returned: number;
}

export class SenditTopCityDto {
  @ApiProperty({ example: 'Casablanca' })
  city: string;

  @ApiProperty({ example: 420 })
  shipments: number;

  @ApiProperty({ example: 398 })
  delivered: number;

  @ApiProperty({ example: 94.76 })
  deliveryRate: number;
}

export class SenditOverviewResponseDto {
  @ApiProperty({ type: SenditOverviewPeriodDto })
  period: SenditOverviewPeriodDto;

  @ApiProperty({ type: SenditOverviewMetricsDto })
  metrics: SenditOverviewMetricsDto;

  @ApiProperty({ type: [SenditStatusBreakdownItemDto] })
  statusBreakdown: SenditStatusBreakdownItemDto[];

  @ApiProperty({ type: [SenditPerformancePointDto] })
  performance: SenditPerformancePointDto[];

  @ApiProperty({ type: [SenditTopCityDto] })
  topCities: SenditTopCityDto[];

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
}
