# Orders — deployed fixes and live verification

Date: 21 October 2026. All five findings from the [expanded production audit](./live-expanded-audit-2026-10-21.md) are fixed, merged to `main`, deployed, and verified through production HTTP requests.

Application commit: `9d4e661190cb9bf9bafaf413e219e2c881ed6f52`  
Serving revision: `zomaal-backend-00070-94q`, 100% traffic  
Health: HTTP 200, expected response  
[CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39636255912): test/build and production deployment both succeeded.

## Live results

**155/155 recorded live observations passed, zero failed.** Counts include setup, persisted-state checks, and cleanup rather than 155 distinct business scenarios. The serving revision's commit label, traffic allocation, and published OpenAPI were checked before testing; the same revision remained ready after cleanup.

| Finding | Fix | Production retest |
|---|---|---|
| ORD-01 — whitespace-only required fields | Required name, phone, and address must contain a non-whitespace character. Valid strings retain their original form to preserve existing request fingerprints. | All three whitespace-only inputs returned 400; no order was created. |
| ORD-02 — invalid currency | Validate officially assigned ISO 4217 codes; normalize case. Omitted currency uses the store currency. | Numeric and unknown alphabetic codes returned 400. Lowercase `mad` returned 201 with `MAD`. |
| ORD-03 — money overflow and partial customer writes | Bound price/shipping inputs and check computed line totals, gross sales, shipping, and final total against Decimal(20,4) capacity before customer mutation. At most four decimal places are accepted. | Individual and computed overflow cases returned 400. No order/customer was created; an existing customer's name/address remained unchanged. Zero amounts and valid four-decimal prices still worked. |
| ORD-04 — permissive query parsing | Accept exact boolean values and complete, safely represented integer strings; leave malformed values for validation to reject. | Invalid booleans returned 400 for both list/export. Fractional/junk/unsafe-integer pagination returned 400. Valid filter exports still matched the list. |
| ORD-05 — timeline ignores active store | Resolve store context through StoreAccessService, including staff assignment, then scope the order lookup to that store. | Switching to another store owned by the same user made the fixture order's timeline return 404, matching detail/products/financials. Correct-store timelines returned 200. |

Other production regressions passed: ordinary creation and totals, exact retries, changed-payload conflicts, simultaneous identical/conflicting retry keys, preservation of original prices after catalog edits, independent creation without retry keys, 100-line and quantity-1000 boundaries, and unchanged stock for undispatched orders.

Fifteen real XLSX/list comparisons passed across documented platform/payment/fulfillment/inclusion/search filters, including header-only empty workbooks. Workbooks retained 20 columns and expected row counts; no formula cell was found. Unsupported enum/filter inputs and unauthenticated export were rejected appropriately.

## Local and CI verification

- `npm test -- --runInBand`: **139 suites, 1,230 tests passed**.
- `TRACKING_TEST_DATABASE_URL=<dedicated local test database> npm run test:e2e -- --runInBand tracking-pack-workflow.postgres`: **68 passed**, including new real-PostgreSQL regressions for invalid-input writes, computed-overflow customer creation/overwrite, owner store switching, another owner, and staff store resolution.
- Focused Orders unit tests passed before the full suite. The export-cap regression is included in the full suite.
- `npm run build`: passed.
- `npx eslint` against every changed TypeScript file: passed.
- `npx prettier --check` against every changed TypeScript file: passed.
- `npx prisma validate`: passed.
- `npm run docs:generate`: passed with placeholder configuration; generated OpenAPI matches the new constraints and timeline scope.
- `git diff --check`: passed.
- CI reran the complete configured quality gates, database workflows, build, deployment, and production smoke test successfully.

No dependency or schema changes and no production migration were required. Rollback would revert the application commit through normal CI/CD.

## Cleanup and scope

The disposable production store and its synthetic orders, customers, catalog, inventory, and related data were deleted through the API. The single uploaded image was removed from cloud storage. Original store selection/list and Home order metrics match the captured baseline. The original account, orders, and credentials remain available.

The dedicated local regression database was verified empty (zero users, stores, customers, orders, and inventory movements) and removed.

This closes the five reported defects. It does not claim exhaustive module acceptance: the 10,001-row capacity guard is covered locally, not by generating that production load; staff and separate-owner isolation were covered in PostgreSQL tests, not with additional live accounts; real courier Delivered/Returned events and physical scanning were not generated by this Orders run. Individual manual-order edit/delete and export date ranges remain outside the current contract.

[Sanitized live observations and deployment proof](./live-fix-retest-results-2026-10-21.json).
