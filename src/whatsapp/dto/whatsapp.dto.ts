import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  WhatsAppBalanceEntryType,
  WhatsAppConnectionStatus,
  WhatsAppMessageStatus,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  MAX_DELAY_MINUTES,
  WHATSAPP_LANGUAGES,
  WHATSAPP_TRIGGERS,
  WhatsAppTemplateStatus,
  type WhatsAppLanguage,
} from '../whatsapp.constants';

const TEMPLATE_STATUSES = Object.values(WhatsAppTemplateStatus);

// ---------- requests ----------

export class ConnectWhatsAppDto {
  @ApiProperty({
    description:
      'One-time `code` from the Embedded Signup FB.login response (response_type=code).',
    example: 'your-embedded-signup-code',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code!: string;

  @ApiProperty({
    description: '`waba_id` from the WA_EMBEDDED_SIGNUP FINISH message event.',
    example: '100000000000000',
  })
  @IsString()
  @Matches(/^\d{5,30}$/, { message: 'wabaId must be a numeric Meta id' })
  wabaId!: string;

  @ApiProperty({
    description:
      '`phone_number_id` from the WA_EMBEDDED_SIGNUP FINISH message event.',
    example: '100000000000001',
  })
  @IsString()
  @Matches(/^\d{5,30}$/, {
    message: 'phoneNumberId must be a numeric Meta id',
  })
  phoneNumberId!: string;

  @ApiPropertyOptional({
    enum: WHATSAPP_LANGUAGES,
    description: 'Language of customer messages. Defaults to fr.',
  })
  @IsOptional()
  @IsIn(WHATSAPP_LANGUAGES)
  language?: WhatsAppLanguage;
}

export class UpdateWhatsAppConnectionDto {
  @ApiProperty({ enum: WHATSAPP_LANGUAGES })
  @IsIn(WHATSAPP_LANGUAGES)
  language!: WhatsAppLanguage;
}

export class UpdateStatusSettingDto {
  @ApiPropertyOptional({ description: 'Send this message automatically.' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_DELAY_MINUTES,
    description:
      'Minutes to wait after the courier status changes. If the parcel moves on before then, the message is skipped.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_MINUTES)
  delayMinutes?: number;
}

export class WhatsAppMessagesQueryDto {
  @ApiPropertyOptional({ enum: WhatsAppMessageStatus })
  @IsOptional()
  @IsEnum(WhatsAppMessageStatus)
  status?: WhatsAppMessageStatus;

  @ApiPropertyOptional({ enum: WHATSAPP_TRIGGERS })
  @IsOptional()
  @IsIn(WHATSAPP_TRIGGERS)
  trigger?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class WhatsAppAnalyticsQueryDto {
  @ApiPropertyOptional({
    description: 'ISO 8601 start (inclusive). Defaults to 30 days before `to`.',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 end (exclusive). Defaults to now.',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Transform(({ value }) => parseInt(value, 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class SetWhatsAppPricingDto {
  @ApiProperty({
    description: 'Zomaal fee per sent message, at most 2 decimals.',
    example: '0.50',
  })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'pricePerMessage must be a positive amount with up to 2 decimals',
  })
  pricePerMessage!: string;
}

export class AdminWhatsAppCreditDto {
  @ApiProperty({
    enum: ['TOP_UP', 'ADJUSTMENT'],
    description:
      'TOP_UP adds paid credit. ADJUSTMENT corrects the balance and may be negative.',
  })
  @IsIn(['TOP_UP', 'ADJUSTMENT'])
  type!: 'TOP_UP' | 'ADJUSTMENT';

  @ApiProperty({
    description: "Amount in the store's base currency, up to 2 decimals.",
    example: '100.00',
  })
  @IsString()
  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: 'amount must be a number with up to 2 decimals',
  })
  amount!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    description:
      'Client-generated key (e.g. a UUID). Retrying with the same key never credits twice.',
    example: 'c0a8012e-7f3b-4f43-9d1e-2b8f5e6a9c10',
  })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,100}$/, {
    message: 'idempotencyKey must be 8-100 letters, digits, - or _',
  })
  idempotencyKey!: string;
}

// ---------- responses ----------

export class WhatsAppConfigResponseDto {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Meta app id for FB.init.',
  })
  appId!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Embedded Signup configuration id for FB.login config_id.',
  })
  configId!: string | null;
  @ApiProperty({ example: 'v21.0' }) graphApiVersion!: string;
  // TEMPORARY — remove with src/whatsapp/mock/ once Meta access is live.
  @ApiPropertyOptional({
    description:
      'TEMPORARY. Present (true) only while the server runs with WHATSAPP_MOCK_DATA=true: every /whatsapp/* response is static preview data (also flagged by the X-Zomaal-Mock-Data header). Skip the Meta popup and call POST /whatsapp/connect with any code and any numeric wabaId / phoneNumberId.',
  })
  mock?: boolean;
}

export class WhatsAppConnectionDetailDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: WhatsAppConnectionStatus })
  status!: WhatsAppConnectionStatus;
  @ApiProperty() wabaId!: string;
  @ApiProperty() phoneNumberId!: string;
  @ApiProperty({ nullable: true, type: String }) displayPhoneNumber!:
    | string
    | null;
  @ApiProperty({ nullable: true, type: String }) verifiedName!: string | null;
  @ApiProperty({ enum: WHATSAPP_LANGUAGES }) language!: string;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty() connectedAt!: string;
  @ApiProperty({ nullable: true, type: String }) disconnectedAt!: string | null;
}

export class TemplateProvisionSummaryDto {
  @ApiProperty() total!: number;
  @ApiProperty({ description: 'Newly sent to Meta for approval.' })
  submitted!: number;
  @ApiProperty({
    description: 'Meta refused the submission; see templates list.',
  })
  failed!: number;
}

export class WhatsAppConnectionResponseDto {
  @ApiProperty({ description: 'True only while the connection is ACTIVE.' })
  connected!: boolean;
  @ApiProperty({ type: WhatsAppConnectionDetailDto, nullable: true })
  connection!: WhatsAppConnectionDetailDto | null;
}

export class WhatsAppConnectResponseDto extends WhatsAppConnectionResponseDto {
  @ApiProperty({
    type: TemplateProvisionSummaryDto,
    nullable: true,
    description:
      'Null when Meta could not be reached; retry with POST /whatsapp/templates/sync.',
  })
  templates!: TemplateProvisionSummaryDto | null;
}

export class WhatsAppDisconnectResponseDto {
  @ApiProperty() disconnected!: boolean;
  @ApiProperty({ description: 'Scheduled messages that were cancelled.' })
  cancelledMessages!: number;
}

export class WhatsAppStatusSettingDto {
  @ApiProperty({ enum: WHATSAPP_TRIGGERS }) trigger!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty() delayMinutes!: number;
  @ApiProperty() templateName!: string;
  @ApiProperty({
    enum: TEMPLATE_STATUSES,
    description: 'Messages are only sent once Meta has APPROVED the template.',
  })
  templateStatus!: string;
  @ApiProperty({
    description:
      'Template text with {{1}} customer name, {{2}} order number, {{3}} store name.',
  })
  body!: string;
}

export class WhatsAppStatusSettingsResponseDto {
  @ApiProperty({ enum: WHATSAPP_LANGUAGES }) language!: string;
  @ApiProperty({
    type: [String],
    example: ['customer_name', 'order_number', 'store_name'],
  })
  variables!: string[];
  @ApiProperty({ type: [WhatsAppStatusSettingDto] })
  data!: WhatsAppStatusSettingDto[];
}

export class WhatsAppTemplateDto {
  @ApiProperty({ enum: WHATSAPP_TRIGGERS }) trigger!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: WHATSAPP_LANGUAGES }) language!: string;
  @ApiProperty() body!: string;
  @ApiProperty({ enum: TEMPLATE_STATUSES }) status!: string;
  @ApiProperty({ nullable: true, type: String }) rejectedReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) updatedAt!: string | null;
}

export class WhatsAppTemplatesResponseDto {
  @ApiProperty({ type: [String] }) variables!: string[];
  @ApiProperty({ type: [WhatsAppTemplateDto] }) data!: WhatsAppTemplateDto[];
}

export class WhatsAppTodayDto {
  @ApiProperty() sent!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() read!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ example: '0.00' }) cost!: string;
}

export class WhatsAppDashboardResponseDto {
  @ApiProperty({ enum: WhatsAppConnectionStatus, nullable: true })
  connectionStatus!: WhatsAppConnectionStatus | null;
  @ApiProperty() connected!: boolean;
  @ApiProperty({ example: '0.00' }) balance!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Null until Zomaal sets a price for this currency.',
  })
  pricePerMessage!: string | null;
  @ApiProperty({ nullable: true, type: Number })
  messagesRemaining!: number | null;
  @ApiProperty() lowBalance!: boolean;
  @ApiProperty({ description: 'Messages waiting for their delay.' })
  scheduled!: number;
  @ApiProperty({ type: WhatsAppTodayDto, description: 'Since 00:00 UTC.' })
  today!: WhatsAppTodayDto;
}

class PageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

class WhatsAppMessageOrderDto {
  @ApiProperty() id!: string;
  @ApiProperty({ nullable: true, type: String }) orderName!: string | null;
}

export class WhatsAppMessageDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: WHATSAPP_TRIGGERS }) trigger!: string;
  @ApiProperty({ enum: WhatsAppMessageStatus }) status!: WhatsAppMessageStatus;
  @ApiProperty({ nullable: true, type: String }) recipientPhone!: string | null;
  @ApiProperty() templateName!: string;
  @ApiProperty() language!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Rendered message text.',
  })
  text!: string | null;
  @ApiProperty({ type: WhatsAppMessageOrderDto, nullable: true })
  order!: WhatsAppMessageOrderDto | null;
  @ApiProperty({ nullable: true, type: String }) cost!: string | null;
  @ApiProperty() currency!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'e.g. INSUFFICIENT_BALANCE, STATUS_CHANGED, NO_VALID_PHONE, TEMPLATE_NOT_APPROVED, or a Meta error code.',
  })
  errorCode!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty() sendAfter!: string;
  @ApiProperty({ nullable: true, type: String }) sentAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) deliveredAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) readAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) failedAt!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WhatsAppMessagesResponseDto {
  @ApiProperty({ type: [WhatsAppMessageDto] }) data!: WhatsAppMessageDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

class AnalyticsTotalsDto extends WhatsAppTodayDto {
  @ApiProperty() skipped!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Percent, 1 decimal.',
  })
  deliveryRate!: number | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Percent, 1 decimal.',
  })
  readRate!: number | null;
}

class AnalyticsTriggerDto {
  @ApiProperty({ enum: WHATSAPP_TRIGGERS }) trigger!: string;
  @ApiProperty() sent!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() failed!: number;
  @ApiProperty() skipped!: number;
}

class AnalyticsDayDto {
  @ApiProperty({ example: '2026-10-18' }) date!: string;
  @ApiProperty() sent!: number;
  @ApiProperty() delivered!: number;
  @ApiProperty() failed!: number;
  @ApiProperty({ example: '0.00' }) cost!: string;
}

export class WhatsAppAnalyticsResponseDto {
  @ApiProperty() from!: string;
  @ApiProperty() to!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: AnalyticsTotalsDto }) totals!: AnalyticsTotalsDto;
  @ApiProperty({ type: [AnalyticsTriggerDto] })
  byTrigger!: AnalyticsTriggerDto[];
  @ApiProperty({ type: [AnalyticsDayDto], description: 'UTC days.' })
  daily!: AnalyticsDayDto[];
}

export class WhatsAppBalanceEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: WhatsAppBalanceEntryType })
  type!: WhatsAppBalanceEntryType;
  @ApiProperty({
    description: 'Signed: negative for message charges.',
    example: '0.00',
  })
  amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ nullable: true, type: String }) note!: string | null;
  @ApiProperty({ nullable: true, type: String }) messageId!: string | null;
  @ApiProperty() createdAt!: string;
}

export class WhatsAppBalanceHistoryResponseDto {
  @ApiProperty({ example: '0.00' }) balance!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [WhatsAppBalanceEntryDto] })
  data!: WhatsAppBalanceEntryDto[];
  @ApiProperty({ type: PageMetaDto }) meta!: PageMetaDto;
}

export class WhatsAppPricingDto {
  @ApiProperty({ example: 'MAD' }) currency!: string;
  @ApiProperty({ example: '0.00' }) pricePerMessage!: string;
  @ApiProperty() updatedAt!: string;
}

export class AdminWhatsAppCreditResponseDto {
  @ApiProperty({ type: WhatsAppBalanceEntryDto })
  entry!: WhatsAppBalanceEntryDto;
  @ApiProperty({ example: '0.00' }) balance!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({
    description: 'True when this idempotencyKey was already used.',
  })
  replayed!: boolean;
}
