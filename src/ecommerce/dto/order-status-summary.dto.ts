import { ApiProperty } from '@nestjs/swagger';
import { RevenuePeriodDto } from './ecommerce-response.dto';

export class OrderStatusBucketDto {
  @ApiProperty({ example: 198, description: 'Order count in this bucket.' })
  orders!: number;

  @ApiProperty({
    example: '34842.00',
    description: 'Sum of netSales for orders in this bucket, in `currency`.',
  })
  value!: string;
}

export class OrderStatusSummaryResponseDto {
  @ApiProperty({ type: RevenuePeriodDto })
  period!: RevenuePeriodDto;

  @ApiProperty({
    example: 'MAD',
    description: "The store's base currency. All bucket values are converted into it.",
  })
  currency!: string;

  @ApiProperty({
    type: OrderStatusBucketDto,
    description:
      'Orders in the period that were not cancelled on the platform. Most stores here are ' +
      'COD-first, so financialStatus stays PENDING until the courier collects payment on ' +
      'delivery — payment status is not a usable "confirmed" signal.',
  })
  confirmed!: OrderStatusBucketDto;

  @ApiProperty({
    type: OrderStatusBucketDto,
    description:
      "Orders whose dispatched courier shipment (Sendit/QuickLivraison/ForceLog/OzoneExpress) reports DELIVERED.",
  })
  delivered!: OrderStatusBucketDto;

  @ApiProperty({
    type: OrderStatusBucketDto,
    description:
      'Orders dispatched to a courier and still moving toward delivery ' +
      '(confirmed/picked up/in transit/out for delivery/postponed/unreachable).',
  })
  inDelivery!: OrderStatusBucketDto;

  @ApiProperty({
    type: OrderStatusBucketDto,
    description: 'Orders the courier reports as refused by the recipient.',
  })
  refused!: OrderStatusBucketDto;

  @ApiProperty({
    type: OrderStatusBucketDto,
    description:
      'Orders cancelled on the e-commerce platform, or whose courier shipment was cancelled.',
  })
  cancelled!: OrderStatusBucketDto;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Most recent update timestamp among the included orders.',
  })
  dataUpdatedAt!: string | null;
}
