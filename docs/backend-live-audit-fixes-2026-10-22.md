# Backend live-audit fixes — 22 October 2026

## Scope and status

Backend-only correction of the eight confirmed groups in the 22 October production audit. Frontend source was not edited. Payment gateway/account onboarding, WhatsApp connection/preview/template editing, billing plan setup, FCM and courier configuration remain outside this fix. Application code and generated OpenAPI are prepared; deployment/live verification will be recorded after merge.

## Changes

| Audit group | Backend correction | Result expected by clients |
| --- | --- | --- |
| LIVE-01 currency relabeling | Accounting currency is fixed at store creation for all stores. A different currency returns 409 before any settings save. The existing currency may be resubmitted. | Handle `reason: STORE_CURRENCY_IMMUTABLE`; keep the original currency and entered settings. |
| LIVE-02 Store nulls | Required names/address/city/country/currency reject null, including optional PATCH-style fields when explicitly present. | 400 with no partial update. Omit unchanged fields. Logo null may still clear the optional logo. |
| LIVE-03 Role nulls | Required role name/permission fields reject null. | 400; `permissions: []` remains a valid removal of grants; optional description can clear. |
| LIVE-04 Category nulls/bounds | Required name/active/position reject null; position capped at database Int max. Optional description clearing now works. | Invalid fields return 400. `description: null` returns 200 and clears it. |
| LIVE-05 blank names | Store text, role names and category names trim before required-text validation. | Whitespace-only values return 400; valid trimmed values persist. |
| LIVE-06 unknown currency | Store create/update validates official ISO 4217 codes; lowercase valid codes normalize. | `ZZZ` returns 400; choose the currency when creating a store. |
| LIVE-07 pagination overflow | Products (including compare picker), Returns and Billing invoice queries accept digit-only integers, page 1–1,000,000 and limit 1–100. | Unsafe, exponent/hex, fractional, junk and duplicate values return 400. |
| LIVE-08 query coercion | Notifications use the same strict bounded integers and exact true/false. Category includeInactive now validates a DTO rather than allowing the global primitive Boolean coercion. | Malformed/duplicate booleans return 400; `includeInactive=false` actually hides archived categories. |

The currency policy deliberately prevents future relabeling without guessing historical exchange rates. It does not convert or repair historical financial records. No schema, migration, dependency or provider configuration change is introduced.

## Regression coverage

- New global-pipe and Store service regressions: **102 passed**.
- Full unit suite: `npm test -- --runInBand` — **142 suites / 1,343 tests passed**.
- New HTTP/PostgreSQL suite: `BACKEND_AUDIT_TEST_DATABASE_URL=<disposable local test DB> npm run test:e2e -- --runInBand backend-audit.postgres` — **18 passed**. Actual controllers, global validation, permission/store resolution and real PostgreSQL constraints run; only test auth identities and the unused upload boundary are replaced.
- All PostgreSQL gates with explicit dedicated test URLs: `npm run test:e2e -- --runInBand postgres` — **13 suites / 345 tests passed**.
- The new PostgreSQL suite runs as a required CI quality step before deployment.
- `npm run build`, Prisma client generation, `npx prisma validate`, local migration status, scoped ESLint and formatting passed. Generated OpenAPI includes the stricter bounds and currency conflict contract.
- `npm run lint -- --no-fix` retains **574 errors / 131 warnings in existing code**. All changed implementation and new test files pass their scoped lint check. Full-repository lint is not claimed clean.
- A clean local PostgreSQL database installed all 67 migrations. Schema drift contains only the previously documented legacy Product-table removals; no missing additions. Those destructive removals were not applied.
- The first sandboxed unit run could not bind the existing HTTP test listener; the authorized rerun outside the sandbox passed.

## Data safety and rollback

Tests use only a disposable localhost PostgreSQL instance on port 5437 with explicit test URLs; application/production database credentials were not used. Test-owned rows are cleaned by each regression suite. No production accounting records or exchange rates are rewritten. Reverting the code requires no database rollback, though it restores the audited validation/accounting defects.

## Deployment and live retest

Pending the authorized merge and normal CI/CD. This section will record the actual commit, run, revision, responses and cleanup after verification. Earlier module reports and the bundled production OpenAPI describe their own captured revision until refreshed after deployment.
