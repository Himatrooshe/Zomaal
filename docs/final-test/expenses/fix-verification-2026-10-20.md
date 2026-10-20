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

**CI/CD and deployed live retest passed.**

- Fix commit `639a58b9add625e3143e2e8a323fe3b193edf311` merged to `main`.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39435910081): Test and build and Deploy production both completed successfully.
- Serving revision `zomaal-backend-00064-jbb`, 100% traffic; ready revision commit checked, health `Hello Zomaal!`.
- **362 recorded live observations: 362 passed, zero failed.** These include requests, assertions, setup and cleanup, not 362 unique business scenarios. [Sanitized evidence and selected responses](./live-fix-retest-results-2026-10-20.json).
- All ten reproduced API/requirements finding groups passed their live retests. Courier aggregation (EXP-11) is implemented and verified with positive, reversed and foreign-currency ledger data in PostgreSQL; production positive-fee acceptance remains limited by the available real dataset.
- Temporary store/expense/category/purchase/packaging/salary fixtures were deleted, two remaining cloud receipt objects removed, and disposable staff deactivated with account deletion scheduled. Original account, store list, expense ledger/summary, Purchases and Home counts were preserved.

### Actual live regression outcomes

| Finding | Retest outcome |
|---|---|
| EXP-01 receipt replacement | Fresh replacement returned 200; simultaneous replacements both returned 200 and the final private image remained readable. |
| EXP-02 receipt replay | Repeating the current attached receipt returned 200. |
| EXP-03 money bounds/precision | Oversized and too-precise positive amounts returned 400; zero/negative and invalid formats also rejected. |
| EXP-04 null PATCH | Required expense and category fields returned 400; nullable notes clearing still worked. |
| EXP-05 source-group protection | Manual creation and reassignment into all four system-managed groups returned 409. |
| EXP-06 retry safety | Two identical header-key submissions created one row, total `1.23`. Body-key retry returned the same expense. Changed payload and deleted-expense retry returned 409; malformed/mismatched keys returned 400. |
| EXP-07 calendar and bounds | Impossible dates returned 400. UTC and offset timestamp endpoints included the exact endpoint; full-day filtering excluded the next midnight when that midnight was outside the requested interval. |
| EXP-08 query integers | Fractional, junk-suffixed and excessive page/limit/month values returned 400. |
| EXP-09 names | Whitespace-only expense/category names returned 400. |
| EXP-10 phone timezone | The local October fixture stayed in October when `timezone=Asia/Dhaka` was supplied; September remained `8.88`. Date-only entry and local-day filtering also passed for Dhaka and New York. |

Normal CRUD, summaries, chart totals, Purchases and Salary links, Home profit effects, viewer restrictions and cross-store isolation passed again on the deployed revision.

### Harness correction

One old offset test expected the previous exclusive timestamp end. Its request ended exactly at the next midnight, which the corrected inclusive API properly included. The request was replayed and returned three rows totaling `7.77`; an endpoint one millisecond earlier returned the two full-day rows totaling `3.33`. The outdated assertion is annotated in the evidence. No product defect was suppressed or changed to obtain this result.

### Selected actual responses

Receipt replacement and current-receipt replay: **HTTP 200**.

Identical creation retries:

```json
{ "statuses": [201, 201], "rowsCreated": 1, "totalAmount": "1.23" }
```

Oversized amount:

```json
{ "message": ["amount must have at most 16 integer digits and 2 decimal places"] }
```

Changed payload or deleted-expense replay: **HTTP 409**.

## External acceptance limits

Nonzero courier fees and currency cases are exercised against real PostgreSQL using local ledger fixtures and controlled exchange-rate inputs; this does not prove a new physical courier delivery or bill occurred. The retained production account previously had four order summaries with zero shipping costs and no ad accounts. Real nonzero courier/ad-provider acceptance remains distinct from the deployed API regression checks. No courier event or fee will be fabricated on production.
