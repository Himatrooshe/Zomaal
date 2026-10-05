import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { StoreAccessService } from '../access/store-access.service';
import { ApiErrorDto } from '../common/dto/api-error.dto';
import { NotificationsService } from './notifications.service';
import {
  MarkAllReadDto,
  MarkAllReadResponseDto,
  NotificationListQueryDto,
  NotificationListResponseDto,
  RegisterPushDeviceDto,
  UnreadCountResponseDto,
} from './dto/notification.dto';

// Not permission-gated as a whole: every user has a notifications screen.
// Per-row visibility (staff only see their modules) is applied in the service.
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid Zomaal access token.',
  type: ApiErrorDto,
})
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Notifications list — All / Critical / Warning / Inventory tabs',
    description:
      'Newest first. Staff only receive alerts for modules their role can view; salary and integration alerts are owner-only.',
  })
  @ApiOkResponse({ type: NotificationListResponseDto })
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: NotificationListQueryDto,
  ): Promise<NotificationListResponseDto> {
    const access = await this.storeAccess.require(user.userId);
    return this.notifications.list(access, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge counts per tab for the calling user' })
  @ApiOkResponse({ type: UnreadCountResponseDto })
  async unreadCount(
    @CurrentUser() user: JwtPayload,
  ): Promise<UnreadCountResponseDto> {
    const access = await this.storeAccess.require(user.userId);
    return this.notifications.unreadCounts(access);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark every visible notification (optionally one tab) as read',
  })
  @ApiOkResponse({ type: MarkAllReadResponseDto })
  async markAllRead(
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkAllReadDto,
  ): Promise<MarkAllReadResponseDto> {
    const access = await this.storeAccess.require(user.userId);
    return this.notifications.markAllRead(access, dto.tab);
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark one notification as read (idempotent)' })
  @ApiParam({ name: 'notificationId', format: 'uuid' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({
    description: 'Not found, or not visible to this user.',
    type: ApiErrorDto,
  })
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ): Promise<void> {
    const access = await this.storeAccess.require(user.userId);
    await this.notifications.markRead(access, notificationId);
  }

  @Put('devices')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Register this device for push notifications',
    description:
      'Call after login and whenever FCM rotates the token. Idempotent per token.',
  })
  @ApiNoContentResponse()
  async registerDevice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterPushDeviceDto,
  ): Promise<void> {
    await this.notifications.registerDevice(
      user.userId,
      dto.token,
      dto.platform,
    );
  }

  @Delete('devices/:token')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop push on this device (call on logout)' })
  @ApiParam({ name: 'token', description: 'FCM registration token' })
  @ApiNoContentResponse()
  async unregisterDevice(
    @CurrentUser() user: JwtPayload,
    @Param('token') token: string,
  ): Promise<void> {
    await this.notifications.unregisterDevice(user.userId, token);
  }
}
