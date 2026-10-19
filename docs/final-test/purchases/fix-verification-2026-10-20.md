# Purchases fixes — local verification, 20 October 2026

## Status

**Update: all six fixes are now deployed in `54e1048` and passed 284 recorded live checks.** See [production results](./live-fix-retest-2026-10-20.md). The following records the earlier local verification phase. The earlier live audit remains the record of the deployed version's failures; its results have not been replaced with local results.

- Branch: `fix/purchases-live-audit-20261020`.
- Worktree: `/private/tmp/zomaal-tracking-workflow`.
- Base: `5aa776d`.
- No commit, merge or deployment performed in this fix pass. The main working directory's existing source changes were preserved.

## Changes

| Finding | Fix | Verification |
|---|---|---|
| PUR-01: concurrent stock drift | Load the purchase, inventory reference and receipt inside every serializable transaction attempt. Compute deltas from that attempt's row. Delete follows the same rule. | PostgreSQL tests force two reads of the same initial purchase, then race edit/edit, edit/delete and delete/delete. Final purchase quantity, expense and stock stay consistent; repeat deletion returns 404. |
| PUR-02: receipt database constraints | Forward migration replaces the original product-only media CHECKs. Receipts and packaging photos can upload and attach; purpose/owner compatibility and one-owner limits remain enforced. Detached assets are allowed during replacement and ON DELETE SET NULL cleanup. | Real Nest HTTP validation and PostgreSQL constraints; only Cloud Storage is mocked. Upload, preview, replacement, clearing and purchase deletion pass. Foreign/reused/expired receipts reject without partial writes. Salary attachment/payment deletion and packaging photos pass. |
| PUR-03: mixed-currency totals | New list/create keys include currency. Group queries honor that currency. Legacy group keys remain supported with null totalCost/currency when mixed, plus totalCostByCurrency. | Same packaging purchased in MAD and USD produces separate list groups. Qualified details contain only that currency. Legacy mixed details never label a cross-currency sum as one currency. |
| PUR-04: money overflow | Bound unitPrice and validate both price and rounded computed total against Decimal(20,4) before writes. | Create and update return 400 for both unit-price overflow and quantity × price overflow. Stock, purchase value and expense count remain unchanged. |
| PUR-05: null PATCH corruption | Validate optional non-clearable fields when present, including null. Date parsing also explicitly rejects non-string input. Notes and receiptAssetId keep their supported null-clearing behaviour. | Null unitPrice, quantity, purchaseDate and paymentMethod return 400. Purchase and expense dates remain unchanged; no stock changes occur. |
| PUR-06: supplier/invoice requirement | Add supplierNames to products/materials; expose in catalog responses and product-options. Add supplierName/invoiceNumber snapshots to purchase create/edit/history. Validate selection against the same store-owned item's names. | Product and packaging HTTP create/edit tests, validation of trimmed/duplicate/blank/null/oversized lists, selected supplier validation, invoice persistence, and preservation after later item supplier changes. |

## Frontend contract

1. Configure `supplierNames` on product create/edit (`PATCH` still requires the product `version`) or packaging create/edit. Maximum 50 case-insensitively unique trimmed names, each 1–120 characters. `[]` clears the list; null is invalid.
2. Read `/purchases/product-options`; use each item's `supplierNames` for selection. No synthetic supplier names are generated.
3. Send optional `supplierName` from that list and `invoiceNumber` (1–100 nonblank characters) to purchase create/edit. They are historical snapshots, independent of future catalog edits. Omit unchanged values on PATCH. Existing and Shop-created purchases can have null snapshots; no backfill invents supplier/invoice information.
4. Treat group keys as opaque. Use the exact key returned by list/create, such as `p_<id>~MAD`, rather than building it. Existing links without a currency suffix still resolve; handle null aggregate money and show `totalCostByCurrency` for mixed histories.
5. Invalid null values and oversized monetary values return 400. Concurrent stock operations can return 409 after bounded retries; reload before retrying.

Supplier/invoice fields remain optional for compatibility; the client answer specifies recording them but does not explicitly mandate rejecting every purchase without them.

## Verification executed

All commands ran in the isolated worktree. PostgreSQL commands explicitly used the dedicated local test database at `127.0.0.1:5434`, never a production URL.

| Command | Outcome |
|---|---|
| `npm test -- --runInBand` | **1,184 tests passed**, 135 suites. |
| `npm run test:e2e -- --runInBand purchases-workflow.postgres` with `PURCHASES_TEST_DATABASE_URL` | **18 passed**. |
| `npm run test:e2e -- --runInBand tracking-pack-workflow.postgres products-edit.postgres returns-workflow.postgres staff-salary.postgres` with the four explicit test URLs | **100 passed**, four suites. |
| `npm run build` | Passed. |
| `npx prisma validate` / `npx prisma migrate status` | Valid schema; all 63 migrations applied locally. |
| `npx prisma migrate reset --force` on the empty disposable local database, then the Purchases PostgreSQL suite | Fresh install succeeded, including the explicit migration transaction; all 18 Purchases cases passed again. |
| `npm run docs:generate` with synthetic local configuration | Passed; OpenAPI regenerated. No provider credentials were used. |
| ESLint and Prettier checks covering every changed TypeScript file | Passed. |
| `npm run lint -- --no-fix` | **Failed in unchanged files:** 588 errors and 143 warnings across the repository. No changed file appears in that failure list; do not describe global lint as clean. |
| `git diff --check` | Passed. |

Prisma generated an initial migration that also proposed removing old legacy product tables because of pre-existing schema drift. Those unrelated DROP TABLE / FK operations were removed before applying the migration. Only the four requested columns and the two media constraints are changed. A schema diff after applying it has no missing additions; the old legacy-table removal drift remains outside this task.

## Migration and rollout

- Migration: `20261020010000_purchases_audit_fields_and_media_constraints`.
- Adds nullable purchase snapshots and supplier-name arrays with empty defaults. No business records are deleted or backfilled with invented values.
- Replaces media CHECKs in the migration transaction. Verify it succeeds before serving the new application, which reads the added columns. The repository's normal migration/deployment sequence can do this.
- CI now runs the new Purchases PostgreSQL suite after applying migrations.
- Application rollback can retain these additive columns and expanded media-purpose constraints. Do not drop supplier/invoice columns after real data has been recorded.
- After deployment rerun the original six failing live cases plus the full receipt lifecycle with isolated fixtures. No live fix signoff is claimed yet.

## Cleanup

The local database contains zero users, stores, purchases, inventory movements and media assets after all regression suites. No new production fixtures or account changes were made in this fix pass.
