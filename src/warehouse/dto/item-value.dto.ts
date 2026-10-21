import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InventoryItemKind } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

function integerQuery(value: unknown): unknown {
  return typeof value === 'string' &&
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : value;
}

export class ItemValueQueryDto {
  @ApiPropertyOptional({ enum: InventoryItemKind })
  @IsOptional()
  @IsEnum(InventoryItemKind)
  kind?: InventoryItemKind;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => integerQuery(value))
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => integerQuery(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class ItemValueLineDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: InventoryItemKind }) kind!: InventoryItemKind;
  @ApiProperty({ format: 'uuid' }) sourceId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ nullable: true, type: String }) variantTitle!: string | null;
  @ApiProperty({ nullable: true, type: String }) sku!: string | null;
  @ApiProperty() onHand!: number;
  @ApiProperty() reserved!: number;
  @ApiProperty() damaged!: number;
  @ApiProperty() available!: number;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'Null when cost is unknown. A confirmed free packaging purchase has zero cost; legacy zero-cost products remain unvalued.',
  })
  unitCost!: string | null;
  @ApiProperty({ nullable: true, type: String }) onHandValue!: string | null;
  @ApiProperty({ nullable: true, type: String }) availableValue!: string | null;
  @ApiProperty({ nullable: true, type: String }) reservedValue!: string | null;
  @ApiProperty({ nullable: true, type: String }) damagedValue!: string | null;
}

export class ItemValueSummaryDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ format: 'date-time' }) asOf!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty() onHandUnits!: number;
  @ApiProperty() availableUnits!: number;
  @ApiProperty() reservedUnits!: number;
  @ApiProperty() damagedUnits!: number;
  @ApiProperty({
    description:
      'Value of units with a known positive unit cost; not a full total when complete is false.',
  })
  knownOnHandValue!: string;
  @ApiProperty() knownAvailableValue!: string;
  @ApiProperty() knownReservedValue!: string;
  @ApiProperty() knownDamagedValue!: string;
  @ApiProperty() unvaluedItemCount!: number;
  @ApiProperty() unvaluedOnHandUnits!: number;
  @ApiProperty() complete!: boolean;
}

export class ItemValueListDto {
  @ApiProperty({ type: [ItemValueLineDto] }) items!: ItemValueLineDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty({ type: ItemValueSummaryDto }) summary!: ItemValueSummaryDto;
}
