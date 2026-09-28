# Staff and salary module

Owner-managed team accounts, permissions, recurring salary obligations, and linked Expenses. This repository provides the backend API; the mobile client implements the Figma screens. Figma names, amounts, and charts are layout examples, never seeded records.

## Access and staff management

Only the active store's owner can manage Staff, Roles, or Salary. A role cannot delegate these actions. Inactive staff cannot sign in or use an existing token to access store data. Removal is deactivation; historical salary records remain.

| Flow | API |
| --- | --- |
| Staff list, search, status filter, counts | `GET /staff` |
| Details, effective permissions, overrides, salary profile | `GET /staff/:staffId` |
| Create login and staff profile | `POST /staff` |
| Update details, password, permissions, status, salary | `PATCH /staff/:staffId` |
| Activate/deactivate | `PATCH /staff/:staffId/status` |
| Upload/replace JPEG, PNG or WebP photo, maximum 5 MiB | `POST /staff/:staffId/photo`, multipart field `photo` |
| Role management | `/roles` |
| Permission catalog | `GET /access/permissions` |
| Current user's permissions and store context | `GET /access/me` |

Create and update accept optional `status` and nested `salary` (same fields as the salary-profile PUT). Account, staff and salary changes commit atomically. Create defaults to ACTIVE. Omitting salary preserves it; omitting or submitting an empty update password preserves the password. Passwords are never returned. Upload the photo after creating the staff member.

A nonempty `permissionOverrides` list replaces the role permissions. An empty list inherits the role. To turn every permission off, clear `roleId` and set `permissionOverrides: []`. Use the permission catalog, which includes both Shop and Analytics, instead of hardcoding the inconsistent Figma toggle lists. Permission denials return 403 with `reason: PERMISSION_DENIED`, `module` and `missingPermissions` for the Access Restricted screen.

## Salary lifecycle and expenses

1. `PUT /staff/:staffId/salary` sets base salary, DAILY/WEEKLY/MONTHLY frequency, start date, CASH/BANK_TRANSFER, expense handling, and notes. `GET` on the same route returns `{ profile: null }` when unset.
2. The scheduler accrues **PENDING** obligations in both expense-handling modes. It never transfers money or marks salaries paid.
3. `POST /staff/salary/payments/:paymentId/pay` confirms an actual payout. Optional fields: `paidAt` (not future), `paymentMethod`, and a previously uploaded `receiptAssetId`.
4. **AUTOMATIC** creates the linked Expense in the confirmation transaction. **MANUAL** leaves expense recording to `POST /staff/salary/payments/:paymentId/expense` after confirmation.

Both actions are retry safe. A salary record can have one linked Expense. The expense uses the confirmed amount, actual payout timestamp and payment method. Salary records retain the amount, frequency and expense-handling agreement from creation; editing a profile does not rewrite them. Creator/payer IDs are retained for audit. Existing historical actor/frequency information remains unknown instead of being invented.

Expenses totals count actual Expense rows once. Pending salary obligations are liabilities shown in Salary, not expense totals. Paid MANUAL salaries appear in Salary paid totals immediately and Expenses only after the explicit record-expense action. Expense responses include `salaryPaymentId` and `staffMemberId` to navigate to the source. Linked salary expenses cannot be directly edited or deleted. Reversal/correction of a confirmed payout is not currently exposed.

## Add Salary Record and retries

`POST /staff/salary/payments` accepts 1–100 `staffMemberIds`, a required UUID `idempotencyKey`, `paymentDate`, `paymentMethod`, and optional amount, frequency, expense handling, notes and receipt. Amount defaults to the person's salary profile; it is required if that person has no profile. Monetary inputs are positive decimal strings with at most two fractional digits, denominated in the store currency.

Default status is PENDING. Explicit `status: PAID` confirms the selected payouts now; it is not a planned-payment switch. Adding a record does not change the recurring salary profile.

Generate a key once per submission and reuse it for retries, including after a timeout. The batch commits entirely or rolls back entirely. Reusing a key with changed data returns 409. There is one salary obligation per staff member per UTC due date. If the scheduler or an earlier submission already created that date, the API returns 409 identifying the existing record; confirm that record instead. The scheduler also recognizes legacy records with no new due-date key.

Upload receipts through `POST /expenses/receipts`. A batch receipt is attached to the first staff member in the submitted list, since an upload has one owning record. It must belong to this store, be unexpired, and not already attached. A stale or foreign receipt rolls back the batch. Repeated confirmation does not attach a receipt again or change an already-confirmed payment.

## Salary screens

| Data | API |
| --- | --- |
| Total paid, pending count and amount, currency | `GET /staff/salary/summary` |
| Actual paid totals by payout month | `GET /staff/salary/trend?months=6` |
| All/Paid/Pending/Overdue list | `GET /staff/salary/payments?status=OVERDUE&page=1&limit=20` |
| A person's payment history | `GET /staff/:staffId/salary/payments` |
| Annual paid, remaining count/amount, projected total | `GET /staff/:staffId/salary/annual-summary?year=2026` |

Payments include photo, job title, frequency snapshot, next scheduled date, expense handling, linked expense ID, and `expenseRecorded`. `displayStatus` derives OVERDUE when an unpaid due date is **before today in UTC**; due today stays PENDING all day. Paid monthly charts use `paidAt`, not the due date. Monetary outputs are strings with two decimal places.

The annual summary combines payments made in the requested UTC year, unpaid records due that year, and remaining occurrences of the current active profile without duplicating existing records. `annualTotal` is a projection, not a fixed annual commitment. `projected` indicates that uncreated occurrences contributed. Inactive staff contribute recorded payments and obligations but no future forecast.

## Scheduler and rollout

Apply migrations with `npx prisma migrate deploy` before starting this version. The additive migration preserves existing payments and expenses. Existing MANUAL profiles without a cursor begin accruing at rollout day or their future start date; no historical debt is fabricated. New profiles begin at their explicit start date, including catch-up if that date is in the past. Editing frequency or amount preserves the current next due date; changing the start date explicitly restarts the schedule.

Configure:

- `STAFF_SALARY_SCHEDULER_ENABLED=true`
- `STAFF_SALARY_SCHEDULER_SECRET`: at least 32 random characters, held in the deployment secret store.
- An external scheduler calling `POST /internal/staff-salary/run` daily (or more often) with `x-zomaal-scheduler-secret`.

Cloud Run needs an external trigger; enabling the environment flag alone does not schedule calls. The endpoint is disabled by default. It processes up to 500 due profiles per invocation, up to 366 periods per active profile, and leaves a cursor for the next invocation. Monitor successful responses and due backlog; invoke more frequently while catching up. Concurrent runs serialize each staff member and atomically commit obligations with cursor advancement. Inactive schedules advance without new obligations; reactivation also advances past inactive periods if the scheduler was unavailable. Monthly schedules preserve the original day, clamping short months (Jan 31 → Feb 28 → Mar 31).

## Verification

- `npm test -- --runInBand`
- `npm run build`
- `npm run docs:generate`
- Against a migrated, disposable test database: `STAFF_TEST_DATABASE_URL=... npm run test:e2e -- --runInBand staff-salary.postgres`

The PostgreSQL suite covers concurrent scheduling/confirmation/batch retries, manual expense recording, transaction rollback, staff creation and reactivation. It only runs when explicitly given `STAFF_TEST_DATABASE_URL`; it never falls back to the application's database. CI runs it against its disposable PostgreSQL service.
