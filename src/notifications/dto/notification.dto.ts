import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationCategory,
  NotificationSeverity,
  PushPlatform,
} from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NOTIFICATION_TABS,
  NotificationType,
  type NotificationTab,
} from '../notification-type';

export class NotificationListQueryDto {
  @ApiPropertyOptional({ enum: NOTIFICATION_TABS, default: 'ALL' })
  @IsOptional()
  @IsIn(NOTIFICATION_TABS)
  tab?: NotificationTab = 'ALL';

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  unreadOnly?: boolean = false;

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

export class MarkAllReadDto {
  @ApiPropertyOptional({
    enum: NOTIFICATION_TABS,
    default: 'ALL',
    description: 'Only mark notifications in this tab as read.',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_TABS)
  tab?: NotificationTab = 'ALL';
}

export class RegisterPushDeviceDto {
  @ApiProperty({
    description: 'FCM registration token from the mobile app.',
    example: 'your-fcm-registration-token',
  })
  @IsString()
  @MaxLength(4096)
  @Matches(/^[A-Za-z0-9:_-]+$/, { message: 'token is not a valid FCM token' })
  token!: string;

  @ApiProperty({ enum: PushPlatform })
  @IsEnum(PushPlatform)
  platform!: PushPlatform;
}

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: Object.values(NotificationType) })
  type!: string;

  @ApiProperty({ enum: NotificationSeverity })
  severity!: NotificationSeverity;

  @ApiProperty({
    enum: NotificationCategory,
    description: 'INVENTORY rows make up the Inventory tab.',
  })
  category!: NotificationCategory;

  @ApiProperty()
  title!: string;

  @ApiProperty({ type: String, nullable: true })
  message!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'What the alert points at, for deep-linking: WAREHOUSE_VARIANT, ECOMMERCE_ORDER, STAFF_SALARY_PAYMENT, ECOMMERCE_CONNECTION, SHIPPING_PROVIDER.',
  })
  entityType!: string | null;

  @ApiProperty({ type: String, nullable: true })
  entityId!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'Type-specific figures (e.g. available units, % change).',
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'When the underlying condition cleared (e.g. stock was replenished). Null while it still holds or for one-off alerts.',
  })
  resolvedAt!: string | null;

  @ApiProperty({ description: 'Read state for the calling user.' })
  isRead!: boolean;

  @ApiProperty({ type: String, nullable: true })
  readAt!: string | null;

  @ApiProperty()
  createdAt!: string;
}

class PaginationDto {
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
  @ApiProperty() totalPages!: number;
}

export class NotificationListResponseDto {
  @ApiProperty({
    type: [NotificationResponseDto],
    description: 'Newest first.',
  })
  items!: NotificationResponseDto[];

  @ApiProperty({ description: 'Unread across all tabs for the calling user.' })
  unreadCount!: number;

  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;
}

export class UnreadCountResponseDto {
  @ApiProperty() all!: number;
  @ApiProperty() critical!: number;
  @ApiProperty() warning!: number;
  @ApiProperty() inventory!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty() marked!: number;
}
