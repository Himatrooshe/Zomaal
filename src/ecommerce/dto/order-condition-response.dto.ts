import { ApiProperty } from '@nestjs/swagger';

export class ShipmentComponentDto {
  @ApiProperty({ format: 'uuid' }) componentVariantId: string;
  @ApiProperty({ type: String, nullable: true }) productCode: string | null;
  @ApiProperty() productName: string;
  @ApiProperty() variantTitle: string;
  @ApiProperty({ description: 'Units of this component in one pack.' })
  quantityPerPack: number;
  @ApiProperty({
    description:
      'Physical units in this order line, including ordered pack quantity.',
  })
  quantity: number;
}

export class ConditionAllocationResponseDto {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  componentVariantId: string | null;
  @ApiProperty({
    description: 'Allocated component units or whole-line units/packs.',
  })
  quantity: number;
  @ApiProperty({
    description: 'Number of physical items represented by this allocation.',
  })
  physicalQuantity: number;
  @ApiProperty({ enum: ['GOOD', 'RETURNED', 'DAMAGED', 'LOST', 'MISSING'] })
  condition: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Explicit total damage cost for this allocation, not a per-unit amount.',
  })
  damageCost: string | null;
  @ApiProperty({
    description:
      'Snapshot purchase cost per allocated unit/component, in order currency.',
  })
  unitCost: string;
  @ApiProperty({
    description:
      'Allocated portion of the actual order-line selling value. Pack components use purchase-cost weights; zero-cost packs use physical quantity weights.',
  })
  saleValue: string;
}
