import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  NotificationCategory,
  NotificationSeverity,
  Prisma,
  PushPlatform,
  StaffStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { StoreAccess } from '../access/store-access.service';
import { resolvePermissions } from '../access/store-access.service';
import { isUniqueConstraintError } from '../common/prisma-errors.util';
import { PushService } from './push.service';
import {
  NOTIFICATION_DEFINITIONS,
  type NotificationTab,
  type NotificationType,
} from './notification-type';
import type {
  NotificationListResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification.dto';

export interface RaiseNotificationInput {
  storeId: string;
  type: NotificationType;
  title: string;
  message?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  /**
   * While a notification with this key is unresolved, raising it again is a
   * no-op. Use a per-occurrence key (e.g. the order id) for one-shot alerts.
   */
  dedupeKey: string;
}

type NotificationRow = Prisma.NotificationGetPayload<{
  include: { reads: { select: { readAt: true } } };
}>;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: PushService,
  ) {}

  /**
   * Creates the notification unless the same condition is already active.
   * Returns null when deduplicated. Push is best-effort and never fails the
   * caller.
   */
  async raise(input: RaiseNotificationInput): Promise<{ id: string } | null> {
    const def = NOTIFICATION_DEFINITIONS[input.type];
    let created: { id: string };
    try {
      created = await this.prisma.notification.create({
        data: {
          storeId: input.storeId,
          type: input.type,
          severity: def.severity,
          category: def.category,
          audiencePermission: def.audiencePermission,
          title: input.title,
          message: input.message ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
          metadata: input.metadata,
          dedupeKey: input.dedupeKey,
        },
        select: { id: true },
      });
    } catch (err) {
      if (isUniqueConstraintError(err)) return null;
      throw err;
    }

    await this.pushNotification(created.id, input).catch((err: Error) =>
      this.logger.warn(
        `Push for notification ${created.id} failed: ${err.message}`,
      ),
    );
    return created;
  }

  /** Marks an active condition as cleared so it can alert again later. */
  async resolve(storeId: string, dedupeKeys: string[]): Promise<number> {
    if (dedupeKeys.length === 0) return 0;
    const { count } = await this.prisma.notification.updateMany({
      where: { storeId, dedupeKey: { in: dedupeKeys } },
      data: { dedupeKey: null, resolvedAt: new Date() },
    });
    return count;
  }

  /**
   * Makes the active set of `type` for this store match `desired`: raises
   * what's new, resolves what no longer holds. Used by the scheduled
   * evaluator for state-based alerts (stock, salary, connections, sales).
   */
  async reconcile(
    storeId: string,
    type: NotificationType,
    desired: RaiseNotificationInput[],
  ): Promise<{ raised: number; resolved: number }> {
    const active = await this.prisma.notification.findMany({
      where: { storeId, type, dedupeKey: { not: null } },
      select: { dedupeKey: true },
    });
    const activeKeys = new Set(active.map((n) => n.dedupeKey as string));
    const desiredKeys = new Set(desired.map((d) => d.dedupeKey));

    let raised = 0;
    for (const input of desired) {
      if (activeKeys.has(input.dedupeKey)) continue;
      if (await this.raise(input)) raised++;
    }
    const stale = [...activeKeys].filter((k) => !desiredKeys.has(k));
    const resolved = await this.resolve(storeId, stale);
    return { raised, resolved };
  }

  async list(
    access: StoreAccess,
    query: {
      tab?: NotificationTab;
      unreadOnly?: boolean;
      page?: number;
      limit?: number;
    },
  ): Promise<NotificationListResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.NotificationWhereInput = {
      ...this.visibleWhere(access),
      ...tabWhere(query.tab ?? 'ALL'),
      ...(query.unreadOnly
        ? { reads: { none: { userId: access.userId } } }
        : {}),
    };

    const [rows, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          reads: { where: { userId: access.userId }, select: { readAt: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.countUnread(access),
    ]);

    return {
      items: rows.map(toResponse),
      unreadCount,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async unreadCounts(access: StoreAccess): Promise<UnreadCountResponseDto> {
    const [all, critical, warning, inventory] = await Promise.all([
      this.countUnread(access, 'ALL'),
      this.countUnread(access, 'CRITICAL'),
      this.countUnread(access, 'WARNING'),
      this.countUnread(access, 'INVENTORY'),
    ]);
    return { all, critical, warning, inventory };
  }

  async markRead(access: StoreAccess, notificationId: string): Promise<void> {
    const found = await this.prisma.notification.findFirst({
      where: { id: notificationId, ...this.visibleWhere(access) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Notification not found');

    await this.prisma.notificationRead.upsert({
      where: {
        notificationId_userId: { notificationId, userId: access.userId },
      },
      create: { notificationId, userId: access.userId },
      update: {},
    });
  }

  async markAllRead(
    access: StoreAccess,
    tab: NotificationTab = 'ALL',
  ): Promise<{ marked: number }> {
    const unread = await this.prisma.notification.findMany({
      where: {
        ...this.visibleWhere(access),
        ...tabWhere(tab),
        reads: { none: { userId: access.userId } },
      },
      select: { id: true },
    });
    if (unread.length === 0) return { marked: 0 };

    const { count } = await this.prisma.notificationRead.createMany({
      data: unread.map((n) => ({
        notificationId: n.id,
        userId: access.userId,
      })),
      skipDuplicates: true,
    });
    return { marked: count };
  }

  async registerDevice(
    userId: string,
    token: string,
    platform: PushPlatform,
  ): Promise<void> {
    // A token belongs to one app install; if another account logs in on the
    // same phone, the token moves to them.
    await this.prisma.pushDevice.upsert({
      where: { token },
      create: { token, platform, userId },
      update: { userId, platform, lastSeenAt: new Date() },
    });
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.prisma.pushDevice.deleteMany({ where: { token, userId } });
  }

  private countUnread(
    access: StoreAccess,
    tab: NotificationTab = 'ALL',
  ): Promise<number> {
    return this.prisma.notification.count({
      where: {
        ...this.visibleWhere(access),
        ...tabWhere(tab),
        reads: { none: { userId: access.userId } },
      },
    });
  }

  /** Owners see everything; staff only see alerts for modules they can view. */
  private visibleWhere(access: StoreAccess): Prisma.NotificationWhereInput {
    if (access.isOwner) return { storeId: access.storeId };
    return {
      storeId: access.storeId,
      audiencePermission: { in: access.permissions },
    };
  }

  private async pushNotification(
    notificationId: string,
    input: RaiseNotificationInput,
  ): Promise<void> {
    if (!this.push.isEnabled) return;

    const userIds = await this.recipientUserIds(
      input.storeId,
      NOTIFICATION_DEFINITIONS[input.type].audiencePermission,
    );
    const sent = await this.push.sendToUsers(userIds, {
      title: input.title,
      body: input.message,
      data: {
        notificationId,
        storeId: input.storeId,
        type: input.type,
        ...(input.entityType ? { entityType: input.entityType } : {}),
        ...(input.entityId ? { entityId: input.entityId } : {}),
      },
    });
    if (sent > 0) {
      await this.prisma.notification.update({
        where: { id: notificationId },
        data: { pushedAt: new Date() },
      });
    }
  }

  private async recipientUserIds(
    storeId: string,
    audiencePermission: string | null,
  ): Promise<string[]> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { userId: true },
    });
    if (!store) return [];
    if (!audiencePermission) return [store.userId];

    const staff = await this.prisma.staffMember.findMany({
      where: { storeId, status: StaffStatus.ACTIVE },
      select: {
        userId: true,
        permissionOverrides: true,
        role: { select: { permissions: true } },
      },
    });
    const staffIds = staff
      .filter((s) =>
        (
          resolvePermissions(
            s.role?.permissions ?? [],
            s.permissionOverrides,
          ) as string[]
        ).includes(audiencePermission),
      )
      .map((s) => s.userId);
    return [store.userId, ...staffIds];
  }
}

function tabWhere(tab: NotificationTab): Prisma.NotificationWhereInput {
  switch (tab) {
    case 'CRITICAL':
      return { severity: NotificationSeverity.CRITICAL };
    case 'WARNING':
      return { severity: NotificationSeverity.WARNING };
    case 'INVENTORY':
      return { category: NotificationCategory.INVENTORY };
    default:
      return {};
  }
}

function toResponse(row: NotificationRow): NotificationResponseDto {
  const readAt = row.reads[0]?.readAt ?? null;
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    category: row.category,
    title: row.title,
    message: row.message,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    isRead: readAt !== null,
    readAt: readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
