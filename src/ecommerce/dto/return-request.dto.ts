import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  PRODUCT_CONDITIONS,
  ProductCondition,
} from '../constants/product-condition';

// -----------------------------------------------------------------------------
// Detect (Scan / Manual Verification screens)
// -----------------------------------------------------------------------------

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
    example: '249.99',
    description: 'Sum of the returned lines\' totalPrice — what the customer paid for these items.',
  })
  originalOrderValue: string;

  @ApiProperty({
    example: '10.00',
    description:
      "The order's own courier fee if dispatched via Zomaal, otherwise the shipping " +
      'amount charged to the customer (we have no visibility into a 3rd-party ' +
      "carrier's real cost) — same proxy convention as OrderFinancialSummaryDto.",
  })
  deliveryCost: string;

  @ApiProperty({
    example: '10.00',
    description:
      'deliveryCost, plus each line\'s loss based on its CURRENT recorded condition: ' +
      '0 for GOOD/RETURNED (restocked), damageCost for DAMAGED (0 if not entered yet), ' +
      "full line value for LOST/MISSING. Lines with no condition recorded yet " +
      'contribute 0 beyond deliveryCost — this is a live preview, not a final figure.',
  })
  netLoss: string;
}

export class DetectedReturnLineDto {
  @ApiProperty({ format: 'uuid' })
  orderLineId: string;

  @ApiPropertyOptional({ nullable: true })
  productCode: string | null;

  @ApiProperty()
  name: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ example: '249.99' })
  totalPrice: string;

  @ApiPropertyOptional({ nullable: true, format: 'uri' })
  imageUrl: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: PRODUCT_CONDITIONS,
    description: 'Already-recorded condition from a previous verification, if any.',
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
    description: 'Customer name — from platform data (Shopify/YouCan/Lightfunnels) or the manual order.',
  })
  customerName: string | null;

  @ApiProperty({ nullable: true })
  customerPhone: string | null;

  @ApiProperty({ nullable: true })
  address: string | null;

  @ApiProperty({ type: [DetectedReturnLineDto] })
  products: DetectedReturnLineDto[];

  @ApiProperty({ type: ReturnLossPreviewDto })
  lossSummary: ReturnLossPreviewDto;
}

// -----------------------------------------------------------------------------
// Verify (Return Detected screen's "Confirm"/Save)
// -----------------------------------------------------------------------------

export class VerifyReturnLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  orderLineId: string;

  @ApiProperty({ enum: PRODUCT_CONDITIONS, example: ProductCondition.DAMAGED })
  @IsIn(PRODUCT_CONDITIONS)
  condition: ProductCondition;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  damageCost?: number;
}

export class VerifyReturnDto {
  @ApiPropertyOptional({
    example: 'Item was damaged during shipping',
    description: 'Free-text return reason shown on the Return Detected screen.',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({ type: [VerifyReturnLineDto] })
  @IsArray()
  @ArrayMinSize(1)
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
    description: "First returned line's product name, plus a count of any others.",
    example: 'Adidas Running Shoes - Black',
  })
  productSummary: string;

  @ApiProperty({ enum: ['NEED_VERIFICATION', 'DELAYED', 'PROCESSED'] })
  status: string;

  @ApiProperty({ example: '249.99' })
  value: string;

  @ApiProperty({ format: 'date-time' })
  createdAt: string;
}

class ReturnSummaryCardDto {
  @ApiProperty({ example: '34842.00' })
  value: string;

  @ApiProperty({ example: 198 })
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
