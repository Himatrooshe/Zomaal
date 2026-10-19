import {
  ShipmentComponentDto,
  ConditionAllocationResponseDto,
} from './order-condition-response.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ArrayMaxSize,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import {
  PRODUCT_CONDITIONS,
  ProductCondition,
} from '../constants/product-condition';

// -----------------------------------------------------------------------------
// Detect (Scan / Manual Verification screens)
// -----------------------------------------------------------------------------

export class ReturnSearchQueryDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    description:
      'Non-empty search term. Leading and trailing whitespace is ignored.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  q: string;
}

export class DetectReturnDto {
  @ApiProperty({
    example: 'DH245411F4E',
    description:
      'Same input as GET /ecommerce/scan: a Zomaal shipment QR payload, a raw courier ' +
      'tracking number, or (for Manual Verification) an order ID/name typed by hand. ' +
      'Ignored when orderId is given. Still required by the request shape — pass the ' +
      "order's own reference (orderName) when using orderId, for the audit trail.",
  })
  @IsString()
  @MinLength(1)
  value: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Skips scan/reference resolution entirely and uses this order directly — set by the ' +
      'client after GET /ecommerce/returns/search returns candidates and the user taps one.',
  })
  @IsOptional()
  @IsString()
  orderId?: string;
}

export class ReturnLossPreviewDto {
  @ApiProperty({
    example: '100.00',
    description:
      "Sum of the returned lines' totalPrice — what the customer paid for these items.",
  })
  originalOrderValue: string;

  @ApiProperty({
    example: '25.00',
    description:
      "The order's own courier fee if dispatched via Zomaal, otherwise the shipping " +
      'amount charged to the customer (we have no visibility into a 3rd-party ' +
      "carrier's real cost) — same proxy convention as OrderFinancialSummaryDto.",
  })
  deliveryCost: string;

  @ApiProperty({
    example: '25.00',
    description:
      'deliveryCost plus the loss for each recorded condition: GOOD/RETURNED = 0; ' +
      'LOST/MISSING = purchase cost × quantity; DAMAGED = entered damage cost, ' +
      'or purchase cost × quantity when no amount is entered. Unlinked lines have ' +
      'no known purchase cost, so only an entered damage cost counts. Unverified ' +
      'lines add no item loss yet. This is a live preview, not a final figure.',
  })
  netLoss: string;
}

export class DetectedReturnLineDto {
  @ApiProperty({ enum: ['STANDARD', 'BUNDLE'], nullable: true }) kind:
    | string
    | null;
  @ApiProperty({ type: [ShipmentComponentDto] })
  components: ShipmentComponentDto[];
  @ApiProperty({ type: [ConditionAllocationResponseDto] })
  allocations: ConditionAllocationResponseDto[];
  @ApiProperty({ type: Boolean, nullable: true }) conditionComplete:
    | boolean
    | null;
  @ApiProperty() conditionRevision: number;

  @ApiProperty({ format: 'uuid' })
  orderLineId: string;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      "Zomaal Product Code of the matched variant (pack code for bundles); null when the order line isn't linked to a Zomaal product.",
  })
  productCode: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ example: '100.00' })
  totalPrice: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  imageUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PRODUCT_CONDITIONS,
    description:
      'Already-recorded condition from a previous verification, if any.',
  })
  condition: string | null;
}

export class DetectedReturnResponseDto {
  @ApiProperty({ format: 'uuid' })
  returnRequestId: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiPropertyOptional({ nullable: true })
  orderName: string | null;

  @ApiProperty({ enum: ['NEED_VERIFICATION', 'DELAYED', 'PROCESSED'] })
  status: string;

  @ApiProperty({
    description:
      'Customer name — from platform data (Shopify/YouCan/Lightfunnels) or the manual order.',
  })
  customerName: string | null;

  @ApiProperty({ nullable: true })
  customerPhone: string | null;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Free-text return reason previously saved on verify, if any. Null until staff records one.',
  })
  reason: string | null;

  @ApiProperty({ type: [DetectedReturnLineDto] })
  products: DetectedReturnLineDto[];

  @ApiProperty({ type: ReturnLossPreviewDto })
  lossSummary: ReturnLossPreviewDto;
}

// -----------------------------------------------------------------------------
// Verify (Return Detected screen's "Confirm"/Save)
// -----------------------------------------------------------------------------

export class VerifyReturnLineDto {
  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Optional conditionRevision from the latest read. Stale changes return 409; identical retries remain safe.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedRevision?: number;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Pack component variant; omit for whole-line/whole-pack conditions.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null ? undefined : value,
  )
  @IsUUID()
  componentVariantId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'Affected physical units (component mode) or ordered units/packs (whole-line mode). All allocations for an included line replace its current snapshot.',
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ format: 'uuid' })
  @IsString()
  orderLineId: string;

  @ApiProperty({ enum: PRODUCT_CONDITIONS, example: ProductCondition.DAMAGED })
  @IsIn(PRODUCT_CONDITIONS)
  condition: ProductCondition;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === null ? undefined : value,
  )
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  damageCost?: number;
}

export class VerifyReturnDto {
  @ApiPropertyOptional({
    example: 'Item damaged in transit',
    description: 'Free-text return reason shown on the Return Detected screen.',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ type: [VerifyReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => VerifyReturnLineDto)
  lines: VerifyReturnLineDto[];
}

export class VerifiedReturnResponseDto {
  @ApiProperty({ format: 'uuid' })
  returnRequestId: string;

  @ApiProperty({ enum: ['NEED_VERIFICATION', 'PROCESSED'] })
  status: string;

  @ApiProperty({ type: ReturnLossPreviewDto })
  lossSummary: ReturnLossPreviewDto;
}

// -----------------------------------------------------------------------------
// List (Returns screen)
// -----------------------------------------------------------------------------

export class ReturnListQueryDto {
  @ApiPropertyOptional({
    enum: ['ALL', 'NEED_VERIFICATION', 'DELAYED', 'PROCESSED'],
    default: 'ALL',
  })
  @IsOptional()
  @IsIn(['ALL', 'NEED_VERIFICATION', 'DELAYED', 'PROCESSED'])
  status?: 'ALL' | 'NEED_VERIFICATION' | 'DELAYED' | 'PROCESSED';

  @ApiPropertyOptional({ description: 'Matches order ID/name.' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}

export class ReturnListItemDto {
  @ApiProperty({ format: 'uuid' })
  returnRequestId: string;

  @ApiProperty({ format: 'uuid' })
  orderId: string;

  @ApiPropertyOptional({ nullable: true })
  orderName: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerName: string | null;

  @ApiPropertyOptional({ nullable: true })
  customerPhone: string | null;

  @ApiProperty({
    description:
      "First returned line's product name, plus a count of any others.",
    example: 'Product name',
  })
  productSummary: string;

  @ApiProperty({ enum: ['NEED_VERIFICATION', 'DELAYED', 'PROCESSED'] })
  status: string;

  @ApiProperty({ example: '100.00' })
  value: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

class ReturnSummaryCardDto {
  @ApiProperty({ example: '0.00' })
  value: string;

  @ApiProperty({ example: 0 })
  orders: number;
}

export class ReturnListSummaryDto {
  @ApiProperty({ type: ReturnSummaryCardDto })
  totalReturns: ReturnSummaryCardDto;

  @ApiProperty({ type: ReturnSummaryCardDto })
  pendingVerification: ReturnSummaryCardDto;

  @ApiProperty({
    type: ReturnSummaryCardDto,
    description:
      'Interpreted as orders awaiting COD confirmation (financialStatus PENDING with a ' +
      'codAmount set) — a different concept from returns, grouped onto the same screen ' +
      'per the mockup. Flag if this interpretation is wrong.',
  })
  totalOrderConfirm: ReturnSummaryCardDto;
}

export class ReturnListResponseDto {
  @ApiProperty({
    example: 'MAD',
    description:
      'Store base currency — same unit as summary card and row values. Not invented from UI mocks.',
  })
  currency: string;

  @ApiProperty({ type: ReturnListSummaryDto })
  summary: ReturnListSummaryDto;

  @ApiProperty({ type: [ReturnListItemDto] })
  data: ReturnListItemDto[];

  @ApiProperty({ example: 42 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 20 })
  limit: number;
}
