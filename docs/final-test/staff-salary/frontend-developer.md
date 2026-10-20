# Staff & Salary — frontend handoff

## API flow

1. Load `GET /access/permissions` for role/override toggles. Staff and Salary management remains owner-only.
2. Use `GET/POST /staff`, `GET/PATCH /staff/:id`, `PATCH /staff/:id/status` and multipart `POST /staff/:id/photo` (`photo` field, PNG/JPEG/WebP, max5MiB).
3. Configure `PUT /staff/:id/salary` with `baseSalary`, `frequency`, `paymentMethod`, `expenseHandling`, `startDate` and device `timezone`. Profile responses now include saved `timezone`; omitted timezone on edits preserves it.
4. Read `/staff/salary/summary`, `/staff/salary/payments`, `/staff/salary/trend`, `/staff/:id/salary/payments` and `/staff/:id/salary/annual-summary`.
5. Submit `POST /staff/salary/payments` with selected staff IDs, UUID `idempotencyKey`, date/method and optional amount/status/receipt. Reuse the key for an unchanged retry. Changed payload or existing due date returns409; show/use the existing record.
6. A MANUAL salary becomes paid through `POST /staff/salary/payments/:id/expense`. An AUTOMATIC pending salary can use `POST /staff/salary/payments/:id/pay`. A paid salary links exactly one readonly Expense.

## Dates and validation

Send the device IANA `timezone` on payment/history lists, trend and annual-summary queries. UTC remains the omitted default. Salary due-date strings encode a calendar label at UTC midnight: display their `YYYY-MM-DD` date part without shifting it. Send date-only inputs from date pickers. Explicit timestamp inputs are assigned to a calendar date in the supplied timezone. `paidAt` is an actual instant; format it in the phone timezone.

Due-today status stays PENDING throughout the phone-local day. Charts group payout timestamps by the local month; annual payout totals use local year boundaries. Summary is all-time. A saved profile timezone controls scheduling; reading with another timezone does not change the agreement.

Names are trimmed and cannot be blank. Omit unchanged required fields; null name/phone/status/salary/permission array returns400. `roleId:null` clears a role; empty overrides inherit the assigned role. Clearing both role and overrides removes all module access. Empty password preserves it.

Only real complete dates are accepted. Malformed/impossible dates, unsafe amounts and out-of-range pagination return400. Page max1,000,000, limit max100; do not submit scientific/hex/fractional page values.

## Behavior to show clearly

Deactivation blocks login and old-token access, but retains the salary agreement and recurring obligations/forecasts. It does not terminate the agreement. Paid means recorded in the accounting ledger; no bank transfer is initiated by these endpoints. Salary-linked Expenses cannot be directly edited/deleted.

Client dependencies remain documented in `docs/module-context/10-staff-salary.md`: staff plan limits, cross-owner phone policy, mid-period agreements and activity-log scope need final client decisions. No invented Figma example salaries are seeded.

See [deployed verification](fix-verification-2026-10-21.md) for the final rollout status and live responses.
