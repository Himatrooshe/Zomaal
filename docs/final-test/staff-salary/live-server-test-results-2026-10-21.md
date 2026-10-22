# Staff & Salary — live API audit, 2026-10-21

> Historical evidence. Original failures and observations below describe the tested revision at that time. Use [the subsequent verification](./fix-verification-2026-10-21.md) and [current module status](../CURRENT-STATUS.md) for resolved findings and remaining acceptance.

## Result

**Not ready for full signoff.** 228 recorded observations: 213 passed, 15 failed expectations across seven finding groups. Counts include setup, assertions, HTTP requests and cleanup; they are not 228 distinct business cases.

- Server: `https://zomaal-backend-563898960389.us-central1.run.app`
- Serving revision: `zomaal-backend-00064-jbb` (application commit `639a58b`).
- Test time: 2026-10-20 around 18:26–18:34 UTC / 2026-10-21 around 00:26–00:34 Asia/Dhaka.
- Actual deployed HTTP requests, including concurrency and uploaded image bytes. No backend implementation changes, commits or deployment in this audit.
- Evidence: [sanitized observations and selected responses](live-server-results-2026-10-21.json).

## Findings

| ID | Finding | Live reproduction | Impact |
| --- | --- | --- | --- |
| STAFF-01 | Recurring salary processing is not enabled in production | `POST /internal/staff-salary/run` → **503**, `Scheduled salary processing is not enabled`. Read-only Cloud Run inspection found no `STAFF_SALARY_*` environment bindings; Cloud Scheduler list contains no salary job. | Both automatic paid records and manual recurring obligations will not accrue on schedule. Configure protected runtime and external trigger, then verify with approved fixtures. This is a deployment gap, not an authentication bypass. |
| STAFF-02 | Null PATCH values bypass DTO validation | `PATCH /staff/:id` with `{name:null}`, `{phone:null}` or `{permissionOverrides:null}` → **500**. `{status:null}` →200 and silently preserves status. | Invalid input should receive400 with actionable validation. `roleId:null` is intentionally valid for removing a role; do not reject all nulls indiscriminately. |
| STAFF-03 | Whitespace-only names accepted | `PATCH /staff/:id` with `{name:"   "}` → **200**. | An unusable staff name is persisted. Trim and validate nonempty content. |
| STAFF-04 | Page overflow causes server errors | `GET /staff?page=999999999999999999999` and `GET /staff/salary/payments?page=999999999999999999999` → **500**. | Bound pagination and reject unsafe numeric values with400 before Prisma. Ordinary fractional, negative and nonnumeric pages already return400. |
| STAFF-05 | Impossible/reduced dates accepted and normalized | Payment creation with `paymentDate:"2026-02-30"` → **201** with a March2 record; `paymentDate:"2026-02"` →201 with February1. Salary-profile PUT accepts both invalid/reduced `startDate` variants with200. | Salary obligations/schedules can be silently saved to an unintended date. Use strict real-calendar validation and an explicit supported date/timestamp contract. All created probe records were isolated and removed. |
| STAFF-06 | Salary reporting has no phone-timezone support | Salary list and trend with `timezone=Asia/Dhaka` → **400**, `property timezone should not exist`. | Client-wide phone-timezone behavior implemented in Home/Expenses is missing here. Source and published staff guide explicitly use UTC for overdue/day/month/year calculations. This is a requirements gap, not a violation of the current UTC-only endpoint schema. Month-boundary correctness cannot be signed off for phone-local displays. |
| STAFF-07 | Inactive annual forecast contradicts published guide | For a staff member with no unpaid records: active annual forecast =2 remaining /401.00; after deactivation it still =2 /401.00 and `projected:true`. | `docs/staff-module.md` says inactive staff have no uncreated future forecast. The same guide separately says deactivation does not stop salary scheduling, so reconcile intended policy and guide before choosing the correction. This is a confirmed contract mismatch; business policy needs a consistent definition. |

## Passed live workflows

- Staff creation with/without nested salary configuration; duplicate-phone rejection; staff list counts, search, pagination and detail; editing name/job title while an empty password preserves login.
- Salary-profile save and update; existing payment amounts remain unchanged after profile amount changes.
- Role assignment, inheritance, replacement overrides, clearing overrides, removing role, rejecting unknown permissions and foreign/unknown roles.
- Staff password replacement: old password401, new password200; synthetic password restored for cleanup.
- Manual salary starts pending/overdue; wrong confirmation route409; expense recording marks paid and links one expense.
- Concurrent manual expense confirmations200/200 with the same expense ID; concurrent identical batch requests201/201 with the same payment ID.
- Same idempotency key replays existing IDs; changed payload409; same employee/due date with new key409.
- Automatic-mode explicit payout confirmation, actual payout date and BANK_TRANSFER payment method; future paidAt rejected400; repeated payment confirmation safe.
- Multi-staff paid batch; missing staff rolls back entire batch; receipt attached only to first submitted staff; receipt replay retains IDs; consumed receipt rejected400.
- Paid/Pending/Overdue list filters, staff history, monthly trend and annual summary endpoints; due-today record stays PENDING in the current UTC contract.
- Exact totals before receipt batch: salary paid30.50, pending30.75 over3 records. Pending includes the two deliberately malformed dates accepted by STAFF-05. These were recognized as accepted-invalid records rather than ignored in expected totals.
- Salary Expense and Home totals agree; salary-linked expenses cannot be directly edited or deleted409.
- Owner-only Staff/Salary/Roles access; staff may read granted Expenses and cannot write them; cross-store staff, salaries, payments and roles blocked404.
- Inactive old token blocked403; inactive login blocked401; reactivation restores login; permission removal applies immediately to an existing token.
- Valid PNG photo upload/replacement/read; corrupt/missing/unsupported uploads400; over5MiB upload413. Salary PNG receipt upload and batch ownership passed.
- Missing authentication401; unknown IDs404; zero/negative/numeric/overprecision/overflow monetary inputs400; invalid permissions, unknown properties and invalid annual years400.

## Cleanup and preservation

- Both disposable QA stores deleted. Temporary staff accounts were deactivated and scheduled for normal30-day deletion before store removal.
- Original QA account and original store set retained; original active store restored.
- Staff list, salary summary/history, Expense ledger/summary, Home order/shipping counts exactly matched pretest snapshots after cleanup.
- The two remaining synthetic GCS objects (one photo and one salary receipt) were removed by exact object name after their store data was deleted. No original media was touched.
- Original owner credentials, bearer/refresh tokens and temporary staff passwords are excluded from published evidence.

## Limits and evidence interpretation

- No live scheduler execution or recurrence/calendar catch-up acceptance: production scheduler is disabled. Existing PostgreSQL tests are not presented as live scheduler coverage.
- Marking a salary PAID records an accounting event; this API does not transfer money through a bank/payment gateway.
- Mobile screens and natural24-hour receipt expiry were not exercised.
- One harness correction: inactive login was initially expected403. The application intentionally returns401 at login and403 for inactive resource access; this denied access correctly. The observation retains the correction explanation.
- No source fix or deployment was made. Resolve findings, deploy through CI/CD, and retest before signing off this module.
