# Orders export memory fix — deployment and live verification

**22 October 2026 (Asia/Dhaka). Status: the confirmed export heap failure is fixed and verified in production.**

- Application commit: `31c0dd4`.
- Cloud Run revision: `zomaal-backend-00071-h7g`, 100% traffic. The 512 MiB container allocation was unchanged.
- [CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39653877979): test/build, constrained-memory gate, production deployment and smoke check succeeded.
- **34/34 recorded live observations passed**, zero failed. Counts include setup and cleanup, not 34 distinct scenarios.

## Change

`EcommerceOrderExportService` now uses ExcelJS's streaming workbook writer, commits each row, disables shared-string accumulation, and retains only the compressed XLSX chunks for the existing Buffer response. The read remains capped at 10,001 orders to enforce the 10,000-row export limit. This bounds the row model's memory rather than increasing the container allocation.

The exported columns, filters, references, numeric money values, money formats, bold/frozen header and autofilter are preserved. Formula-like order references remain text. No dependency, schema, migration or API contract change was required.

A unit regression reads the full 10,000-row workbook. A separate CI gate runs the compiled production exporter with `--max-old-space-size=96`; that flag limits old space, while total V8 heap includes young space. Local peak process RSS was about 126 MiB. The gate runs after build on every CI run.

## Live retest

A fresh store was created through the production API. Exactly 10,001 labeled, zero-customer, pending manual-order rows were seeded directly into its isolated connection for export testing; this does not exercise bulk order creation through the public API. The new revision was confirmed at 100% traffic before export requests.

| Check | Production result |
| --- | --- |
| 10,001 matching rows | 413, no partial workbook |
| Exactly 10,000 matching rows | 200, valid XLSX, approximately 7.5 seconds |
| Workbook content | 10,000 unique data rows, 20 columns, own-store references only |
| Money and references | Numeric MAD 12.34 amounts, money formats and plain-text formula-like reference preserved |
| Workbook layout | Frozen header and autofilter preserved |
| Two concurrent 10,000-row exports | Both 200 with valid ZIP/XLSX signatures |
| Small filtered / empty export | Correct single row / header-only workbook |
| Invalid boolean / unauthenticated request | 400 / 401 |
| Original active store searching fixture references | Header-only export |
| Health after large/concurrent exports | 200, expected health response |

The new revision had zero matching heap/memory-failure log entries in the checked retest interval. This is observed log evidence at the query time, not a guarantee for arbitrary future load. The old crash was on revision 70 and is preserved in the historical report.

## Local verification

- `npm test -- --runInBand`: **139 suites, 1,231 tests passed**.
- `ORDER_EXPORT_TEST_DATABASE_URL=<disposable local DB> npm run test:e2e -- --runInBand orders-export.postgres`: **1 passed**. The local database contained zero users/stores after cleanup and was dropped.
- `npm run build`: passed.
- `node --max-old-space-size=96 scripts/test-order-export-memory.cjs`: 10,000 rows, valid compressed workbook, peak RSS 128,992 KiB.
- Targeted ESLint and Prettier on changed files: passed.
- `npx prisma validate`: passed.
- `npm run docs:generate` with synthetic local configuration: passed; generated contract unchanged. Initial attempts lacked valid local environment settings and were corrected before the successful run.
- `git diff --check`: passed.

## Additional courier diagnostics

Bounded synchronization used existing merchant connections during CI/CD, before rollout; those diagnostics ran on revision 70. QuickLivraison imported two pre-existing provider parcels successfully. ForceLog and OzoneExpress sync succeeded with zero imports. Their stored-list/overview contracts remained usable.

**Ameex is externally blocked:** import returns `success: false`, `failed: 1`; its direct status probe returns 502 for upstream 403. The provider explicitly reports Imunify360 bot protection and requests allowlisting automation IPs. The two failed acceptance assertions refer to that same external firewall blocker, not two new application defects. HTTP 200 alone must not be treated as successful synchronization.

**Sendit is disconnected:** sync correctly returns 409. It needs a valid merchant connection for a genuine end-to-end test.

See [courier diagnostic observations](./live-courier-sync-results-2026-10-22.json) and [concrete client/provider actions](../shipping/client-actions-2026-10-22.md). These external prerequisites were not bypassed or replaced with static data.

## Cleanup and remaining acceptance

The isolated export store and all 10,000 remaining rows were deleted through the app's owner-authorized store API; a scoped database read confirmed zero fixture orders and no fixture store. The original active store, store list and Home order/catalog metrics matched their baselines. No courier parcel was created during this fix retest. The two genuine QuickLivraison imports were kept. The temporary proxy was stopped and its database connection file removed.

The export bug is closed. Still open: Ameex firewall access, Sendit connection, a fresh controlled courier-dashboard parcel/order match, genuine provider Delivered/Returned events with financial/stock reconciliation, and physical frontend/device scanning. Earlier ForceLog real-label/software-decoding and return tests remain recorded separately. A code fix cannot certify those external/device workflows.

[Sanitized export observations](./live-export-memory-fix-results-2026-10-22.json) · [Historical failure and ForceLog flow](./live-courier-flow-2026-10-22.md).
