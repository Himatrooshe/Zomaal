# Products edit fixes — 20 October 2026

Commit: `6f8d8d4` (`fix(products): resolve live edit and unused variant failures`).

CI/CD: [production workflow](https://github.com/Himatrooshe/Zomaal/actions/runs/39302757532).

Status: merged to main, CI/CD and production smoke passed, and all five fixes passed live retesting.

## Changes

| Original bug | Fix |
|---|---|
| PROD-01: main-image replacement returns 500 | Detach old media inside the edit transaction as TEMPORARY with an immediate expiry; attach replacement, commit, then delete old storage asset. This respects MediaAsset_attachment_check. |
| PROD-02: gallery removal returns 500 | Use the same constraint-safe detachment and post-commit cleanup. Variant-image replacement uses it too. |
| PROD-03: nullable description returns 500 | Null-safe normalization; null clears the description. OpenAPI continues to specify a nullable string. |
| PROD-04: whitespace-only names accepted | Trim and validate names for HTTP create/bundle/edit; service validation also rejects blank names. Null edited names return 400. |
| PROD-05: unused variant deletion returns 500 | Delete only its empty OPENING_BALANCE initialization rows (quantityDelta and resultingQuantity both zero) inside the transaction, then delete the unused variant. |

Removal safeguards are stricter: any current stock, actual inventory movement, purchase, order, gift use or bundle use prevents deletion. A variant that previously had stock remains protected after its quantity reaches zero. Real movement history is retained; clearing stock is not a way to remove a used variant. Archive the product instead.

No schema or production configuration changes were needed. An interrupted media cleanup leaves an expired temporary asset eligible for the existing expiry cleanup.

## Local verification

- `npm test -- --runInBand`: **135 suites / 1,182 tests passed**.
- `PRODUCTS_TEST_DATABASE_URL=<dedicated-local-test-db> npm run test:e2e -- --runInBand products-edit.postgres`: **13 tests passed**, using real PostgreSQL constraints and HTTP validation. Only the object-storage boundary and authentication identity were stubbed; permission/store resolution remained real.
- `npm run build`: passed.
- ESLint for the five changed TypeScript files: passed.
- Prettier check for changed TypeScript/workflow files and `git diff --check`: passed.
- `npm run docs:generate` with documentation-only environment values: passed.
- Local database fixtures cleaned: users 0, products 0, inventory movements 0. Disposable database removed afterward.

The first full-suite attempt was blocked by sandbox port-binding restrictions; the rerun outside the sandbox passed. Initial integration fixture setup omissions were corrected before the passing run.

The PostgreSQL suite covers image replace/remove, variant-image replace, rollback after an invalid replacement, nullable descriptions, blank/null edited names, blank create/bundle service names, unused-variant removal, unchanged sibling audit history, and protection of stock/purchase history. CI now runs it before deployment.

## Live verification

The original archived QA products were retested through the production API. All **60 HTTP/status and semantic checks passed**; this count includes setup/read checks, not 60 distinct user scenarios.

| Check | Live result |
|---|---|
| PROD-01 main-image replacement | 200, new image present; old image content returns 404 |
| PROD-02 gallery removal | 200, removed image absent; content returns 404 |
| PROD-03 description null | 200, persisted as null |
| PROD-04 whitespace-only name | 400; name and product version unchanged; null name also rejected |
| PROD-05 unused zero-stock variant | 200; variant absent; removed inventory item returns 404 |
| Variant-image replacement | 200; new image present; old image removed |
| Invalid replacement with gallery upload | 400; original name, version and main image retained |
| Used variant now at zero stock | Removal rejected 400; all movement history unchanged |
| Cleanup/account integrity | All four QA/imported products remain archived with zero stock; orders and shipping unchanged; no dispatch created; Home catalog complete with zero active warehouse products |

No new order, shipment or product was created in this retest. Images attached to archived QA products remain for audit/reference. One wrong-purpose upload used to verify rollback remains temporary and is eligible for the existing expiry cleanup.

[Sanitized live retest results](./fix-live-server-results-2026-10-20.json).

## Remaining module limits

The broader untested scenarios in the [initial live report](./live-server-test-results.md#scope-limits) still apply: real courier delivery triggers, nonzero sales performance, packaging consumption, other identities, disconnected platform imports and currency conversion are separate checks.
