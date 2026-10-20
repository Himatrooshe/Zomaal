import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EcommerceOrderStatus, EcommercePlatform } from '@prisma/client';
import { Transform } from 'class-transformer';
import { strictInteger } from '../../common/calendar-date.util';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export const DUPLICATE_LOOKBACK_MAX_DAYS = 90;

// ---------- requests ----------

export class DuplicateOrdersQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: DUPLICATE_LOOKBACK_MAX_DAYS,
    default: 30,
    description: 'Show groups with a duplicate placed in the last N days.',
  })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(DUPLICATE_LOOKBACK_MAX_DAYS)
  days?: number = 30;

  @ApiPropertyOptional({ minimum: 1, maximum: 1000000, default: 1 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(1000000)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(strictInteger)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class CancelDuplicateOrdersDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      'Orders selected on the Duplicate Orders screen. Each must be in a current group, and at least one order of every group must stay.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderIds!: string[];
}

// ---------- responses ----------

export class DuplicateOrderCustomerDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: 'E.164 phone — the grouping key.' })
  phone!: string;
  @ApiProperty({ nullable: true, type: String }) name!: string | null;
  @ApiProperty() isBlacklisted!: boolean;
}

export class DuplicateOrderProductDto {
  @ApiProperty() name!: string;
  @ApiProperty() quantity!: number;
}

export class DuplicateOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) orderName!: string | null;
  @ApiProperty({ enum: EcommercePlatform }) platform!: EcommercePlatform;
  @ApiProperty({ enum: EcommerceOrderStatus }) status!: EcommerceOrderStatus;
  @ApiProperty({ description: 'When the customer placed the order.' })
  placedAt!: string;
  @ApiProperty({ example: '0.00' }) totalCollected!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() itemCount!: number;
  @ApiProperty({ type: [DuplicateOrderProductDto] })
  products!: DuplicateOrderProductDto[];
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Courier dispatch status (PENDING / DISPATCHED / FAILED).',
  })
  dispatchStatus!: string | null;
  @ApiProperty({
    description: 'False once the order was handed to a courier.',
  })
  canCancel!: boolean;
}

export class DuplicateOrderGroupDto {
  @ApiProperty({ description: 'Group id = the main order id.' })
  id!: string;
  @ApiProperty({
    enum: ['SAME_PHONE_SAME_PRODUCT'],
    description: 'Same customer phone and a shared product within the window.',
  })
  reason!: 'SAME_PHONE_SAME_PRODUCT';
  @ApiProperty({ type: DuplicateOrderCustomerDto })
  customer!: DuplicateOrderCustomerDto;
  @ApiProperty({ type: DuplicateOrderDto, description: 'Oldest order.' })
  mainOrder!: DuplicateOrderDto;
  @ApiProperty({ type: [DuplicateOrderDto], description: 'Oldest first.' })
  duplicates!: DuplicateOrderDto[];
  @ApiProperty({ description: 'When the newest duplicate was placed.' })
  lastPlacedAt!: string;
}

class DuplicateOrdersMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class DuplicateOrdersResponseDto {
  @ApiProperty({ example: 24 }) windowHours!: number;
  @ApiProperty() from!: string;
  @ApiProperty() totalGroups!: number;
  @ApiProperty({
    description: 'Duplicates across all groups (mains excluded).',
  })
  totalDuplicates!: number;
  @ApiProperty({ type: [DuplicateOrderGroupDto], description: 'Newest first.' })
  data!: DuplicateOrderGroupDto[];
  @ApiProperty({ type: DuplicateOrdersMetaDto }) meta!: DuplicateOrdersMetaDto;
}

export class CancelledDuplicateOrderDto {
  @ApiProperty() orderId!: string;
  @ApiProperty({ nullable: true, type: String }) orderName!: string | null;
  @ApiProperty({ enum: EcommercePlatform }) platform!: EcommercePlatform;
  @ApiProperty({
    description:
      'True for Shopify / YouCan / Lightfunnels orders: Zomaal blocked dispatch, but the merchant must also cancel the order on the platform.',
  })
  platformCancelRequired!: boolean;
}

export class CancelDuplicateOrdersResponseDto {
  @ApiProperty({ type: [CancelledDuplicateOrderDto] })
  cancelled!: CancelledDuplicateOrderDto[];
}

export class KeepDuplicateGroupResponseDto {
  @ApiProperty({ description: 'Duplicates marked as real separate orders.' })
  kept!: number;
}
