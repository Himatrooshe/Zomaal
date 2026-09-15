import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { SuperAdminJwtPayload } from '../interfaces/super-admin-jwt-payload.interface';

export const ActivityEntity = {
  ADMIN: 'ADMIN',
  MERCHANT: 'MERCHANT',
  SHOP_PRODUCT: 'SHOP_PRODUCT',
  SHOP_CATEGORY: 'SHOP_CATEGORY',
  SHOP_ORDER: 'SHOP_ORDER',
  SHOP_BANNER: 'SHOP_BANNER',
  SHOP_PROMO: 'SHOP_PROMO',
  SHOP_SETTINGS: 'SHOP_SETTINGS',
} as const;
export type ActivityEntity =
  (typeof ActivityEntity)[keyof typeof ActivityEntity];

export interface ActivityEntry {
  action: string;
  entityType: ActivityEntity;
  entityId?: string | null;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Best-effort: a failed audit write must never roll back or fail the
  // admin action that already succeeded — it's logged loudly instead.
  async record(actor: SuperAdminJwtPayload, entry: ActivityEntry) {
    try {
      await this.prisma.superAdminActivityLog.create({
        data: {
          adminId: actor.adminId,
          adminUsername: actor.username,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          summary: entry.summary,
          metadata: entry.metadata,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to record admin activity ${entry.action}: ${String(error)}`,
      );
    }
  }

  async list(params: {
    limit: number;
    cursor?: string;
    entityType?: string;
    entityId?: string;
  }) {
    const rows = await this.prisma.superAdminActivityLog.findMany({
      where: {
        ...(params.entityType ? { entityType: params.entityType } : {}),
        ...(params.entityId ? { entityId: params.entityId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > params.limit;
    const items = rows.slice(0, params.limit).map((row) => ({
      id: row.id,
      adminUsername: row.adminUsername,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      summary: row.summary,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    }));

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }
}
