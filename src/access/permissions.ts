/**
 * The permission catalogue, taken directly from the Staff Details screen's
 * module list and its sub-actions.
 *
 * Permissions are stored on Role as a string[] of these keys rather than as
 * boolean columns, so a new sub-action never needs a migration — a role just
 * starts carrying one more string.
 *
 * Naming is always `<module>.<action>`. `<module>.view` is the read gate for
 * that module; the other actions are writes and should each be checked
 * independently rather than inferred from `view`.
 */
export const PERMISSION_MODULES = {
  ORDERS: 'orders',
  RETURNS: 'returns',
  PRODUCTS: 'products',
  EXPENSES: 'expenses',
  ADS: 'ads',
  CUSTOMERS: 'customers',
  ANALYTICS: 'analytics',
  SHOP: 'shop',
} as const;

export type PermissionModule =
  (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];

export const PERMISSIONS = {
  // "View orders, Edit Orders, Cancel Orders, Export Orders"
  ORDERS_VIEW: 'orders.view',
  ORDERS_EDIT: 'orders.edit',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_EXPORT: 'orders.export',

  // "View Returns, Process Returns, Scan Returns"
  RETURNS_VIEW: 'returns.view',
  RETURNS_PROCESS: 'returns.process',
  RETURNS_SCAN: 'returns.scan',

  // "View Products, Edit Products, Add Products, Delete Products"
  PRODUCTS_VIEW: 'products.view',
  PRODUCTS_ADD: 'products.add',
  PRODUCTS_EDIT: 'products.edit',
  PRODUCTS_DELETE: 'products.delete',

  // "View Expenses, Add Expenses, Edit Expenses, Delete Expenses"
  EXPENSES_VIEW: 'expenses.view',
  EXPENSES_ADD: 'expenses.add',
  EXPENSES_EDIT: 'expenses.edit',
  EXPENSES_DELETE: 'expenses.delete',

  // "View Ads" — the Add/Edit Staff screens label this module "Advertising",
  // Staff Details labels it "Ads". Same module, one key.
  ADS_VIEW: 'ads.view',

  // "View Customers, Manage Blacklist"
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_BLACKLIST: 'customers.blacklist',

  // "View Analytics, Export Analytics"
  ANALYTICS_VIEW: 'analytics.view',
  ANALYTICS_EXPORT: 'analytics.export',

  // Add/Edit Staff shows a "Shop" toggle in the same slot where Staff Details
  // shows "Analytics". Both are defined so whichever way the design settles,
  // the backend already supports it — see the note in the plan.
  SHOP_VIEW: 'shop.view',
  SHOP_PURCHASE: 'shop.purchase',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Grouped for the UI's module-with-sub-actions layout. */
export const PERMISSIONS_BY_MODULE: Record<PermissionModule, Permission[]> = {
  [PERMISSION_MODULES.ORDERS]: [
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.ORDERS_EDIT,
    PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.ORDERS_EXPORT,
  ],
  [PERMISSION_MODULES.RETURNS]: [
    PERMISSIONS.RETURNS_VIEW,
    PERMISSIONS.RETURNS_PROCESS,
    PERMISSIONS.RETURNS_SCAN,
  ],
  [PERMISSION_MODULES.PRODUCTS]: [
    PERMISSIONS.PRODUCTS_VIEW,
    PERMISSIONS.PRODUCTS_ADD,
    PERMISSIONS.PRODUCTS_EDIT,
    PERMISSIONS.PRODUCTS_DELETE,
  ],
  [PERMISSION_MODULES.EXPENSES]: [
    PERMISSIONS.EXPENSES_VIEW,
    PERMISSIONS.EXPENSES_ADD,
    PERMISSIONS.EXPENSES_EDIT,
    PERMISSIONS.EXPENSES_DELETE,
  ],
  [PERMISSION_MODULES.ADS]: [PERMISSIONS.ADS_VIEW],
  [PERMISSION_MODULES.CUSTOMERS]: [
    PERMISSIONS.CUSTOMERS_VIEW,
    PERMISSIONS.CUSTOMERS_BLACKLIST,
  ],
  [PERMISSION_MODULES.ANALYTICS]: [
    PERMISSIONS.ANALYTICS_VIEW,
    PERMISSIONS.ANALYTICS_EXPORT,
  ],
  [PERMISSION_MODULES.SHOP]: [
    PERMISSIONS.SHOP_VIEW,
    PERMISSIONS.SHOP_PURCHASE,
  ],
};

/**
 * Managing staff and roles is deliberately absent from this catalogue: it is
 * owner-only and can never be delegated to a staff member, so it is gated by
 * the owner check in StoreAccessService rather than by a permission a role
 * could be given.
 */
export function isValidPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as string[]).includes(value);
}
