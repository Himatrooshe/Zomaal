import { ApiProperty } from '@nestjs/swagger';
import { RiskProximityDto } from './blacklist.dto';

export class RiskScoreDto {
  @ApiProperty({ example: 3 }) returns!: number;
  @ApiProperty({ example: 1 }) cancellations!: number;
  @ApiProperty({ example: 0 }) refusals!: number;
  @ApiProperty({ example: 0 }) noAnswer!: number;
  @ApiProperty({
    example: 4,
    description: 'Sum of the four counters above.',
  })
  totalRiskActions!: number;
}

export class CustomerOrderHistoryItemDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  orderId!: string;

  @ApiProperty({ example: '#12345', nullable: true, type: String })
  orderName!: string | null;

  @ApiProperty({
    example: 'Wireless Headphones',
    nullable: true,
    type: String,
    description:
      'First line item name, for the single-line summary shown on the Order History row.',
  })
  productSummary!: string | null;

  @ApiProperty({ example: 'Delivered' })
  status!: string;

  @ApiProperty({ example: '2026-04-16T00:00:00.000Z', format: 'date-time' })
  occurredAt!: string;
}

export class CustomerSummaryDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  id!: string;

  @ApiProperty({ example: '+8801400715037' })
  phone!: string;

  @ApiProperty({ example: 'Alex Sansioun', nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    example: '123 Main Street, Apt 4B, New York, NY 10001',
    nullable: true,
    type: String,
  })
  address!: string | null;

  @ApiProperty({ example: 9 })
  totalOrders!: number;

  @ApiProperty({
    example: false,
    description:
      'One risk action away from crossing whichever store-configured blacklist limit applies.',
  })
  isHighRisk!: boolean;

  @ApiProperty({ example: false })
  isBlacklisted!: boolean;
}

export class CustomerListResponseDto {
  @ApiProperty({ type: [CustomerSummaryDto] }) customers!: CustomerSummaryDto[];
  @ApiProperty({ example: 1247 }) totalCustomers!: number;
  @ApiProperty({ example: 22 }) highRiskCount!: number;
  @ApiProperty({ example: 1 }) page!: number;
  @ApiProperty({ example: 20 }) limit!: number;
}

export class CustomerDetailResponseDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440001' })
  id!: string;

  @ApiProperty({ example: '01400715037' })
  phone!: string;

  @ApiProperty({ example: 'Ahamed Rifat', nullable: true, type: String })
  name!: string | null;

  @ApiProperty({
    example: 'Araihazar, narayanganj',
    nullable: true,
    type: String,
  })
  address!: string | null;

  @ApiProperty({ example: 9 })
  totalOrders!: number;

  @ApiProperty() riskScore!: RiskScoreDto;

  @ApiProperty({ example: false })
  isBlacklisted!: boolean;

  @ApiProperty({ example: null, nullable: true, type: String })
  blacklistReason!: string | null;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
    format: 'date-time',
  })
  blacklistedAt!: string | null;

  @ApiProperty({
    description:
      'Present only when not blacklisted and within 1 action of a configured limit — backs the "High Risk Customers — N actions away from blacklist" banner. Null otherwise (including for a blacklisted customer, who gets the Blacklisted banner instead).',
    type: RiskProximityDto,
    nullable: true,
  })
  riskProximity!: RiskProximityDto | null;

  @ApiProperty({ type: [CustomerOrderHistoryItemDto] })
  orders!: CustomerOrderHistoryItemDto[];
}
