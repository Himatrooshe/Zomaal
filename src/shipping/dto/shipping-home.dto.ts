import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional } from 'class-validator';

export class ShippingHomeQueryDto {
  @ApiPropertyOptional({
    description: 'Rolling UTC reporting period. Use 1 for Today.',
    enum: [1, 7, 30, 90],
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([1, 7, 30, 90])
  days?: 1 | 7 | 30 | 90;
}

class ShippingHomePeriodDto {
  @ApiProperty({ enum: [1, 7, 30, 90] }) days: number;
  @ApiProperty({ format: 'date-time' }) from: string;
  @ApiProperty({ format: 'date-time' }) to: string;
  @ApiProperty({ enum: ['UTC'] }) timezone: 'UTC';
}

class ShippingCostMetricDto {
  @ApiProperty({ example: '3842.0000' }) cost: string;
  @ApiProperty({ example: 198 }) shipments: number;
  @ApiProperty({ example: 190 }) pricedShipments: number;
}

class ShippingProviderCostDto extends ShippingCostMetricDto {
  @ApiProperty({
    enum: ['sendit', 'quicklivraison', 'forcelog', 'ozoneexpress', 'ameex'],
  })
  provider: 'sendit' | 'quicklivraison' | 'forcelog' | 'ozoneexpress' | 'ameex';
}

export class ShippingHomeResponseDto {
  @ApiProperty({ type: ShippingHomePeriodDto }) period: ShippingHomePeriodDto;
  @ApiProperty({ enum: ['MAD'] }) currency: 'MAD';
  @ApiProperty({ example: '738456.0000' }) totalShippingCost: string;
  @ApiProperty({ example: '3.4500', nullable: true })
  averageShippingCostPerPricedShipment: string | null;
  @ApiProperty({ example: 1245 }) totalShipments: number;
  @ApiProperty({ example: 1150 }) pricedShipments: number;
  @ApiProperty({ example: 92.37 }) costCoveragePercentage: number;
  @ApiProperty({ type: ShippingCostMetricDto })
  delivery: ShippingCostMetricDto;
  @ApiProperty({ type: ShippingCostMetricDto })
  cancelled: ShippingCostMetricDto;
  @ApiProperty({ type: ShippingCostMetricDto }) refused: ShippingCostMetricDto;
  @ApiProperty({ type: ShippingCostMetricDto }) pickup: ShippingCostMetricDto;
  @ApiProperty({ type: [ShippingProviderCostDto] })
  providers: ShippingProviderCostDto[];
  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  dataUpdatedAt: string | null;
}
