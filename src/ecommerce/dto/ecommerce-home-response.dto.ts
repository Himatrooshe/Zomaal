import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EcommerceConnectionDto,
  RevenueSummaryDto,
} from './ecommerce-response.dto';
import { EcommerceOrderDto } from './ecommerce-order-response.dto';

export class EcommerceHomeOrderMetricsDto {
  @ApiProperty({ example: 420 })
  total!: number;

  @ApiProperty({ example: 38 })
  inPeriod!: number;

  @ApiProperty({ example: 14 })
  open!: number;

  @ApiProperty({ example: 9 })
  unfulfilled!: number;

  @ApiProperty({ example: 6 })
  readyToDispatch!: number;

  @ApiProperty({ example: 120 })
  dispatched!: number;

  @ApiProperty({ example: 7 })
  cancelled!: number;

  @ApiProperty({ example: 5 })
  refunded!: number;
}

export class EcommerceHomeCatalogMetricsDto {
  @ApiProperty({ example: 210 })
  connectedProducts!: number;

  @ApiProperty({ example: 1300 })
  connectedCustomers!: number;

  @ApiProperty({ example: 46 })
  warehouseProducts!: number;

  @ApiProperty({ example: 39 })
  activeWarehouseProducts!: number;

  @ApiProperty({ example: true })
  complete!: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    nullable: true,
  })
  metricsFreshAsOf!: string | null;
}

export class EcommerceHomeShippingMetricsDto {
  @ApiProperty({ example: 2 })
  connectedProviders!: number;

  @ApiProperty({ example: 131 })
  totalDispatches!: number;

  @ApiProperty({ example: 1 })
  pending!: number;

  @ApiProperty({ example: 120 })
  dispatched!: number;

  @ApiProperty({ example: 10 })
  failed!: number;
}

export class EcommerceHomeProfitDto {
  @ApiProperty({
    example: '8442.00',
    description:
      "Sum of every order's netProfitImpact from the financial-event ledger for orders " +
      'processed in the period, converted to the store base currency.',
  })
  value!: string;
}

export class EcommerceHomeLostOrdersDto {
  @ApiProperty({
    example: 78,
    description:
      'Count of orders in the period that were cancelled, or whose dispatched courier ' +
      'shipment was refused or cancelled.',
  })
  orders!: number;

  @ApiProperty({
    example: '4842.00',
    description: 'Sum of netSales for the lost orders above, in the store base currency.',
  })
  value!: string;
}

export class EcommerceHomeResponseDto {
  @ApiProperty({ example: 'MAD' })
  baseCurrency!: string;

  @ApiProperty({ type: RevenueSummaryDto })
  revenue!: RevenueSummaryDto;

  @ApiProperty({ type: EcommerceHomeOrderMetricsDto })
  orders!: EcommerceHomeOrderMetricsDto;

  @ApiProperty({ type: EcommerceHomeCatalogMetricsDto })
  catalog!: EcommerceHomeCatalogMetricsDto;

  @ApiProperty({ type: EcommerceHomeShippingMetricsDto })
  shipping!: EcommerceHomeShippingMetricsDto;

  @ApiProperty({ type: EcommerceHomeProfitDto })
  profit!: EcommerceHomeProfitDto;

  @ApiProperty({ type: EcommerceHomeLostOrdersDto })
  lostOrders!: EcommerceHomeLostOrdersDto;

  @ApiProperty({ type: [EcommerceConnectionDto] })
  connections!: EcommerceConnectionDto[];

  @ApiProperty({ type: [EcommerceOrderDto] })
  recentOrders!: EcommerceOrderDto[];
}
