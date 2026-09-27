# Staff module

Owner-managed team accounts, roles/permissions, and salary payments that feed Expenses.

## Who uses what

| Actor | Can do |
|-------|--------|
| **Store owner** | Full Staff management, Roles CRUD, salary profiles/payments. Staff/Roles are never delegatable via a permission. |
| **Staff** | Log in with phone + password. Use only modules granted by role / overrides. Edit own profile/photo. Cannot open Staff or Roles APIs. |

Figma placeholder amounts and names are layout only — never seed them. Money is store currency as Decimal → API strings `.toFixed(2)`.

## Owner flows

1. **Staff management** — `GET /staff` (search, status, `total` / `activeCount`, salary cues: `baseSalary`, `salaryFrequency`, `nextPaymentDate`).
2. **Add / Edit staff** — `POST /staff`, `PATCH /staff/:id` (phone + password login, role, `permissionOverrides`).
3. **Deactivate** — `PATCH /staff/:id/status` (`ACTIVE` / `INACTIVE`). No hard delete.
4. **Roles** — `GET|POST|PATCH|DELETE /roles` (owner-only).
5. **Manage Salary Info** — `PUT /staff/:id/salary` with `expenseHandling`:
   - **AUTOMATIC** — Cloud Scheduler hits `POST /internal/staff-salary/run`; creates `StaffSalaryPayment` (PAID) + linked Expense; blocks manual entry (409).
   - **MANUAL** — owner records via `POST /staff/salary/payments` (batch); still creates linked Expense so Expenses stay consistent.
6. **Salary tab** — `GET /staff/salary/summary`, `GET /staff/salary/trend`, `GET /staff/salary/payments?status=PAID|PENDING|OVERDUE`.

`displayStatus` on payments: `PAID` | `PENDING` | `OVERDUE`. Overdue = stored `PENDING` with `paymentDate` in the past (derived at read time).

## Staff session bootstrap

After login:

- `GET /access/me` — `isOwner`, `staffMemberId`, `status`, `roleName`, `effectivePermissions`, `permissionsByModule`.
- `GET /access/permissions` — full catalogue for Add/Edit Staff toggles.

Without a required permission, APIs return **403** with:

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "message": "You don't have permission to access {Module}. Please contact your store owner to request access.",
  "reason": "PERMISSION_DENIED",
  "module": "orders",
  "missingPermissions": ["orders.view"]
}
```

Use this for the Access Restricted screen.

## Permission enforcement

Catalogue: `src/access/permissions.ts` (`orders.*`, `returns.*`, `products.*`, `expenses.*`, `ads.*`, `customers.*`, `analytics.*`, `shop.*`).

Wired with `PermissionGuard` + `@RequirePermission` on:

- Expenses, Customers, Shop/Purchases (already)
- Ecommerce orders, returns, home/revenue (analytics), warehouse products/categories/inventory/barcodes/packaging/media, Ads, shipping home (`orders.view`)

Platform OAuth / connection connect flows stay JWT store-scoped without staff permission keys. Webhooks and internal schedulers are not staff-gated.

## Branch

Work on `module/staff-roles-expenses` (merge `origin/main` before continuing). Do not implement day-to-day on `main`.
