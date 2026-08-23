import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderTimelineEventDto {
  @ApiProperty({ description: 'Zomaal internal event ID', format: 'uuid' })
  id: string;

  @ApiProperty({ description: 'Normalized event type', example: 'IN_TRANSIT' })
  type: string;

  @ApiProperty({ description: 'Human-readable event title', example: 'In transit' })
  title: string;

  @ApiPropertyOptional({ nullable: true, description: 'Additional detail from the platform' })
  message: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Who performed the action (carrier, merchant, platform)' })
  actor: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'City or region where the event occurred' })
  location: string | null;

  @ApiProperty({ description: 'When this event occurred on the platform', format: 'date-time' })
  occurredAt: string;

  @ApiProperty({
    description: 'True when reconstructed from stored order timestamps rather than a real platform event',
  })
  synthetic: boolean;
}

export class OrderTimelineTrackingDto {
  @ApiPropertyOptional({ nullable: true, description: 'Carrier name as reported by the platform' })
  carrier: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Tracking number' })
  number: string | null;

  @ApiPropertyOptional({ nullable: true, format: 'uri', description: 'Public tracking URL' })
  url: string | null;
}

export class OrderTimelineDto {
  @ApiProperty({ description: 'Zomaal internal order ID', format: 'uuid' })
  orderId: string;

  @ApiProperty({ enum: ['SHOPIFY', 'YOUCAN', 'LIGHTFUNNELS'] })
  platform: string;

  @ApiProperty({ description: 'True when timeline data is available for this order' })
  available: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Why timeline is unavailable. Only present when available is false.',
    example: 'NO_EVENTS',
  })
  reason?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Normalized type of the most recent event',
    example: 'DELIVERED',
  })
  currentStatus: string | null;

  @ApiProperty({
    description: 'True when the platform API failed and cached events are being returned',
  })
  stale: boolean;

  @ApiPropertyOptional({
    nullable: true,
    format: 'date-time',
    description: 'When the timeline data was last successfully fetched from the platform',
  })
  dataUpdatedAt: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: () => OrderTimelineTrackingDto,
    description: 'Shipping tracking info from the platform carrier plugin (Shopify only)',
  })
  tracking: OrderTimelineTrackingDto | null;

  @ApiProperty({ type: [OrderTimelineEventDto], description: 'Events newest-first' })
  events: OrderTimelineEventDto[];
}
