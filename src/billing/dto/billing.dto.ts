import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { BillingInterval } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ALL_PLAN_FEATURES, type PlanFeature } from '../plan-features';
import {
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from '../subscription-status.util';

const MONEY = /^\d{1,16}(?:\.\d{1,2})?$/;
const MONEY_MESSAGE = 'must be a positive amount with at most 2 decimal places';

export class PlanResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Stable code, e.g. STARTER or PRO.' })
  code!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when not sold monthly.',
  })
  monthlyPrice!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Null when not sold yearly.',
  })
  yearlyPrice!: string | null;

  @ApiProperty() currency!: string;
  @ApiProperty() taxIncluded!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null = unlimited stores.',
  })
  maxStores!: number | null;

  @ApiProperty({ enum: ALL_PLAN_FEATURES, isArray: true })
  features!: PlanFeature[];

  @ApiProperty({
    type: [String],
    description: 'Bullets for the Plans & Pricing screen.',
  })
  featureList!: string[];

  @ApiProperty() isActive!: boolean;
  @ApiProperty() sortOrder!: number;
}

class EntitlementsDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null = unlimited.',
  })
  maxStores!: number | null;

  @ApiProperty({ description: 'Stores this account owns now.' })
  storesUsed!: number;

  @ApiProperty({ enum: ALL_PLAN_FEATURES, isArray: true })
  features!: PlanFeature[];
}

export class SubscriptionResponseDto {
  @ApiProperty({
    enum: SUBSCRIPTION_STATUSES,
    description:
      'TRIALING / ACTIVE = full access. TRIAL_ENDED / EXPIRED = read-only: data stays visible, changes and syncing stop.',
  })
  status!: SubscriptionStatus;

  @ApiProperty({
    description: 'True when TRIAL_ENDED or EXPIRED — show the plan overlay.',
  })
  isReadOnly!: boolean;

  @ApiProperty({
    type: PlanResponseDto,
    nullable: true,
    description: 'Null during the free trial.',
  })
  plan!: PlanResponseDto | null;

  @ApiProperty({ enum: BillingInterval, nullable: true })
  interval!: BillingInterval | null;

  @ApiProperty({ type: String, nullable: true }) trialEndsAt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Only while TRIALING — for the banner.',
  })
  trialDaysLeft!: number | null;

  @ApiProperty({ type: String, nullable: true }) currentPeriodStart!:
    | string
    | null;
  @ApiProperty({ type: String, nullable: true }) currentPeriodEnd!:
    | string
    | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      '"Next billing" date. Null when cancelled, trialing, or expired.',
  })
  renewsAt!: string | null;

  @ApiProperty({
    description: 'Cancelled; access continues until currentPeriodEnd.',
  })
  cancelAtPeriodEnd!: boolean;

  @ApiProperty({ type: String, nullable: true }) canceledAt!: string | null;

  @ApiProperty({
    description: 'When access ends (trial end or paid period end).',
  })
  accessEndsAt!: string;

  @ApiProperty({ example: 'MANUAL' }) provider!: string;

  @ApiProperty({
    type: Object,
    nullable: true,
    description:
      'Card on file. Always null until a payment gateway is integrated.',
  })
  paymentMethod!: null;

  @ApiProperty({ type: EntitlementsDto }) entitlements!: EntitlementsDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Web page where the owner pays (Q17.1: web only). Null until configured.',
  })
  checkoutUrl!: string | null;

  @ApiProperty({
    description:
      'True for the owner. Staff can see status but not cancel or view invoices.',
  })
  canManage!: boolean;
}

export class BillingInvoiceResponseDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() planName!: string;
  @ApiProperty({ enum: BillingInterval }) interval!: BillingInterval;
  @ApiProperty({ description: 'Decimal string, 2 places.' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty() periodStart!: string;
  @ApiProperty() periodEnd!: string;
  @ApiProperty() paidAt!: string;
  @ApiProperty({ example: 'MANUAL' }) provider!: string;
  @ApiProperty({ type: String, nullable: true }) providerReference!:
    | string
    | null;
}

class PaginationDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class BillingInvoiceListResponseDto {
  @ApiProperty({
    type: [BillingInvoiceResponseDto],
    description: 'Newest first.',
  })
  items!: BillingInvoiceResponseDto[];

  @ApiProperty({ type: PaginationDto }) pagination!: PaginationDto;
}

export class InvoiceListQueryDto {
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
  @Max(100)
  limit?: number = 20;
}

// ---------------------------------------------------------------- admin ----

export class CreatePlanDto {
  @ApiProperty({
    example: 'STARTER',
    description: 'Uppercase letters, digits, underscore.',
  })
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,31}$/, {
    message: 'code must be 2-32 uppercase letters, digits or underscores',
  })
  code!: string;

  @ApiProperty({ example: 'Starter' })
  @IsString()
  @Length(1, 60)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: '99.00',
    description: 'Omit if not sold monthly.',
  })
  @IsOptional()
  @Matches(MONEY, { message: `monthlyPrice ${MONEY_MESSAGE}` })
  monthlyPrice?: string;

  @ApiPropertyOptional({
    example: '990.00',
    description: 'Omit if not sold yearly.',
  })
  @IsOptional()
  @Matches(MONEY, { message: `yearlyPrice ${MONEY_MESSAGE}` })
  yearlyPrice?: string;

  @ApiPropertyOptional({ default: 'MAD' })
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 code',
  })
  currency?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  taxIncluded?: boolean;

  @ApiPropertyOptional({
    minimum: 1,
    description: 'Omit for unlimited stores.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxStores?: number | null;

  @ApiPropertyOptional({
    enum: ALL_PLAN_FEATURES,
    isArray: true,
    default: [],
    description: 'Paid features this plan unlocks. Empty = core app only.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PLAN_FEATURES, { each: true })
  features?: PlanFeature[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  featureList?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class ActivateSubscriptionDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  planId!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  interval!: BillingInterval;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 24,
    default: 1,
    description: 'How many intervals were paid for.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  periods?: number;

  @ApiProperty({ example: '99.00', description: 'Amount actually received.' })
  @Matches(MONEY, { message: `amount ${MONEY_MESSAGE}` })
  amount!: string;

  @ApiPropertyOptional({ description: "Defaults to the plan's currency." })
  @IsOptional()
  @Matches(/^[A-Za-z]{3}$/, {
    message: 'currency must be a 3-letter ISO 4217 code',
  })
  currency?: string;

  @ApiPropertyOptional({ description: 'Defaults to now.' })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @ApiPropertyOptional({
    description: 'Bank transfer reference, receipt number…',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  providerReference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ExtendTrialDto {
  @ApiProperty({ minimum: 1, maximum: 90 })
  @IsInt()
  @Min(1)
  @Max(90)
  days!: number;
}

export class AdminSubscriptionResponseDto {
  @ApiProperty({ type: SubscriptionResponseDto })
  subscription!: SubscriptionResponseDto;
  @ApiProperty({ type: [BillingInvoiceResponseDto] })
  invoices!: BillingInvoiceResponseDto[];
}
