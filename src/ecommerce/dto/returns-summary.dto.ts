import { ApiProperty } from '@nestjs/swagger';
import { RevenuePeriodDto } from './ecommerce-response.dto';

export class ReturnsBucketDto {
  @ApiProperty({ example: 5, description: 'Item quantity in this bucket.' })
  items!: number;

  @ApiProperty({
    example: '38.00',
    description: 'Value of the items in this bucket, in `currency`.',
  })
  value!: string;
}

export class ReturnsSummaryResponseDto {
  @ApiProperty({ type: RevenuePeriodDto })
  period!: RevenuePeriodDto;

  @ApiProperty({
    example: 'MAD',
    description: "The store's base currency. All bucket values are converted into it.",
  })
  currency!: string;

  @ApiProperty({
    type: ReturnsBucketDto,
    description:
      'Order lines scanned back in as GOOD or RETURNED (restocked) via ' +
      'POST /ecommerce/orders/:orderId/condition.',
  })
  received!: ReturnsBucketDto;

  @ApiProperty({
    type: ReturnsBucketDto,
    description:
      'Order lines on orders whose courier shipment is in a return-in-progress state ' +
      '(return pending/in transit/at warehouse/inspection) but no condition has been recorded yet.',
  })
  pending!: ReturnsBucketDto;

  @ApiProperty({
    type: ReturnsBucketDto,
    description:
      'Order lines scanned in as DAMAGED. Value uses the recorded damageCost when present, ' +
      'falling back to the line total.',
  })
  damaged!: ReturnsBucketDto;

  @ApiProperty({
    type: ReturnsBucketDto,
    description: 'Order lines scanned in as MISSING or LOST.',
  })
  missing!: ReturnsBucketDto;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'Most recent order-line update timestamp among the included orders.',
  })
  dataUpdatedAt!: string | null;
}
