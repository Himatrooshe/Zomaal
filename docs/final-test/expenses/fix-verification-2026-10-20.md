# Expenses fixes — 20 October 2026

## Changes

- Receipt replacement, clearing and deletion serialize on the expense row. The previous attachment is detached inside the transaction and removed from storage after commit. Retrying the current attachment succeeds; invalid replacements roll back metadata and attachment changes.
- Manual amounts require a positive decimal with at most 16 integer digits and two decimal places. Required expense/category PATCH fields reject null; nullable notes/receipt URL can be cleared. Names are trimmed and cannot contain only whitespace.
- Manual creation and reassignment into SHIPPING, ADS, SALARY and PURCHASES return 409.
- `POST /expenses` accepts `Idempotency-Key` or a body `idempotencyKey`. Both must match when supplied. Keys contain 8–100 letters, digits, dots, underscores, colons or hyphens. Concurrent identical requests return the same expense; changed data returns 409. An additive `ExpenseCreateRequest` table retains deletion tombstones to stop delayed retries recreating deleted charges. Legacy clients without a key can still create separate expenses and must not automatically retry POST.
- Calendar dates are validated strictly; timestamps require an explicit offset. Date-only filters include the full day and explicit timestamp upper bounds are inclusive. Query integers no longer truncate decimals/junk; page is capped at 1,000,000, limit at 100 and months at 24.
- Expenses list/summary/trend accept the phone's IANA `timezone`. Creation/edit accepts it to interpret date-only `spentAt`. The default remains UTC for existing clients; the frontend must send the device timezone. DST boundaries are resolved from calendar days rather than assuming a fixed offset.
- Summary/trend read signed courier costs from the existing immutable financial-event ledger. Revenue reversals, reinstatements and shipping losses follow the same signs as order financials. Fees use their financial-event timestamps. Real FX conversion is applied and missing rates are exposed as `unconvertedShippingCosts`.
- Home Expenses includes these courier costs; profit already includes them through the order ledger and does not subtract them again. Chart responses include timezone and unconverted shipping/ad spend. Daily ad metrics retain their provider calendar dates.

## Database and rollout

The additive migration creates only `ExpenseCreateRequest`, its unique indexes and foreign keys. Existing expenses are retained; no backfill, table drop or destructive reset is used. The old application can run while the added table remains in place if code rollback is needed.

Historical manually entered ADS/SHIPPING expenses remain recorded. There is no reliable correspondence between those manual rows and a courier bill/ad metric, so the backend does not silently erase or guess a reconciliation. Review any legacy manual source-group entries if they duplicate provider costs.

## Verification

- Full unit run: 135 suites, 1,184 tests passed.
- All eight PostgreSQL workflow gates: 198 tests passed, including 57 new Expenses regressions.
- Build, Prisma validation, generated-schema drift check (only existing legacy removals), scoped ESLint and scoped TypeScript formatting passed.
- Repository lint still fails on existing issues (last run: 587 errors and 140 warnings). It is not a passing verification gate. New implementation and Expenses regression suite passed their separate lint check.
- A Packaging test fixture now explicitly marks the job due before dispatch assertions, avoiding millisecond rounding at its default timestamp. No Packaging runtime behavior was changed.
- The initial [production audit](./live-server-test-results-2026-10-20.md) remains the pre-fix baseline.

## Deployment and live retest

Pending CI/CD and the deployed regression run.

## External acceptance limits

Nonzero courier fees and currency cases are exercised against real PostgreSQL using local ledger fixtures and controlled exchange-rate inputs; this does not prove a new physical courier delivery or bill occurred. The retained production account previously had four order summaries with zero shipping costs and no ad accounts. Real nonzero courier/ad-provider acceptance remains distinct from the deployed API regression checks. No courier event or fee will be fabricated on production.
