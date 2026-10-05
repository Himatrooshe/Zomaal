import { NotificationCategory, NotificationSeverity } from '@prisma/client';
import { PERMISSIONS, type Permission } from '../access/permissions';

export const NotificationType = {
  LOW_STOCK: 'LOW_STOCK',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  SALARY_OVERDUE: 'SALARY_OVERDUE',
  BLACKLISTED_CUSTOMER_ORDER: 'BLACKLISTED_CUSTOMER_ORDER',
  SALES_DROP: 'SALES_DROP',
  PLATFORM_DISCONNECTED: 'PLATFORM_DISCONNECTED',
  PLATFORM_SYNC_FAILED: 'PLATFORM_SYNC_FAILED',
  COURIER_SYNC_FAILED: 'COURIER_SYNC_FAILED',
} as const;

export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export interface NotificationDefinition {
  severity: NotificationSeverity;
  category: NotificationCategory;
  /** Null = owner-only. */
  audiencePermission: Permission | null;
}

/**
 * Severity, tab and audience are fixed per type so every producer agrees and
 * the Critical / Warning / Inventory tabs stay consistent.
 */
export const NOTIFICATION_DEFINITIONS: Record<
  NotificationType,
  NotificationDefinition
> = {
  LOW_STOCK: {
    severity: NotificationSeverity.WARNING,
    category: NotificationCategory.INVENTORY,
    audiencePermission: PERMISSIONS.PRODUCTS_VIEW,
  },
  OUT_OF_STOCK: {
    severity: NotificationSeverity.CRITICAL,
    category: NotificationCategory.INVENTORY,
    audiencePermission: PERMISSIONS.PRODUCTS_VIEW,
  },
  SALARY_OVERDUE: {
    severity: NotificationSeverity.WARNING,
    category: NotificationCategory.STAFF,
    audiencePermission: null,
  },
  BLACKLISTED_CUSTOMER_ORDER: {
    severity: NotificationSeverity.CRITICAL,
    category: NotificationCategory.CUSTOMERS,
    audiencePermission: PERMISSIONS.CUSTOMERS_VIEW,
  },
  SALES_DROP: {
    severity: NotificationSeverity.WARNING,
    category: NotificationCategory.SALES,
    audiencePermission: PERMISSIONS.ANALYTICS_VIEW,
  },
  PLATFORM_DISCONNECTED: {
    severity: NotificationSeverity.CRITICAL,
    category: NotificationCategory.INTEGRATIONS,
    audiencePermission: null,
  },
  PLATFORM_SYNC_FAILED: {
    severity: NotificationSeverity.WARNING,
    category: NotificationCategory.INTEGRATIONS,
    audiencePermission: null,
  },
  COURIER_SYNC_FAILED: {
    severity: NotificationSeverity.WARNING,
    category: NotificationCategory.INTEGRATIONS,
    audiencePermission: null,
  },
};

/** The four Figma tabs. */
export const NOTIFICATION_TABS = [
  'ALL',
  'CRITICAL',
  'WARNING',
  'INVENTORY',
] as const;
export type NotificationTab = (typeof NOTIFICATION_TABS)[number];
