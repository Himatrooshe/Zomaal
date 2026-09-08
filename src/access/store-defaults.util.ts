import { PERMISSIONS } from './permissions';

/**
 * Seeded once, at store creation, so a brand-new store is never left with an
 * empty role dropdown or category list on the Add Staff / Add Expense
 * screens. `isSystem: true` protects these from deletion (Role/ExpenseCategory
 * are still editable — see the isSystem comment on each model) but an owner
 * is free to add more of either.
 */
export function defaultRoleSeeds() {
  return [
    {
      name: 'Staff',
      description: 'View-only access to day-to-day operations. Adjust as needed.',
      isSystem: true,
      permissions: [
        PERMISSIONS.ORDERS_VIEW,
        PERMISSIONS.RETURNS_VIEW,
        PERMISSIONS.PRODUCTS_VIEW,
        PERMISSIONS.CUSTOMERS_VIEW,
      ],
    },
  ];
}

export function defaultExpenseCategorySeeds() {
  return [
    { name: 'Shipping', group: 'SHIPPING' as const, isSystem: true },
    { name: 'Advertising', group: 'ADS' as const, isSystem: true },
    { name: 'Salaries', group: 'SALARY' as const, isSystem: true },
    { name: 'Purchases', group: 'PURCHASES' as const, isSystem: true },
    { name: 'Other', group: 'OTHER' as const, isSystem: true },
  ];
}
