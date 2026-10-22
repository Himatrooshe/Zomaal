# QA — tracking and pack returns

## Handoff status — 22 October 2026

Main corrections `75c8524`/`9a090ca` and callback follow-up `5aa776d` passed 97/97 live observations. Pack components, condition revisions, retry safety, financial reconciliation, staff financial access and confirmed provider cancellation are covered. Subsequent Orders export/provider acceptance is in the Orders and Shipping reports. Genuine delivery/return events and physical scanning are still open.

[Verification evidence](./live-fix-retest-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

**Latest: [fix deployment and live retest](./live-fix-retest-2026-10-20.md) — all reported findings resolved; 97 live checks passed.**
Implementation `75c8524`. [Verification report](./fix-verification-2026-10-20.md); [frontend/API contract](./frontend-developer.md). The original 28/38 result is historical.

## Automated regression gate

The suite `test/tracking-pack-workflow.postgres.e2e-spec.ts` runs against dedicated local/CI PostgreSQL. The follow-up fix report records 65 tracking tests and 1,184 unit tests passing at that revision; older 59/1,182 counts describe the earlier phase. The later Item Value release records 1,241 passing unit tests across 140 suites. These are recorded results, not a rerun against this older working checkout.

## Scenarios to verify in the UI

1. Resolve distinct orders sharing a product code. Tracking collisions must produce 409; cross-store reads must fail without revealing another store's order.
2. Two packs containing 2 A and 1 B each must show A=4, B=2, correct codes and parent line IDs. Test raw tracking and QR; stale QR status must not override backend status.
3. Verify all five whole-pack conditions. Split components and simple quantities into GOOD/DAMAGED/LOST/MISSING. Partial totals stay pending; complete mixed totals process.
4. Reject overflow, zero/negative/fractional/null quantities, foreign component IDs, mixed whole-pack/component rows and ambiguous duplicates. Verify no stock, condition, request-status or ledger changes after rejection.
5. Retry identical requests; check stock and ledger remain unchanged. Change a stale revision: 409. Refresh and correct; prior movements/losses must reconcile rather than accumulate.
6. Correct a completed return back to partial: saved status reopens. With another open return, reject reopening an older completed one before mutation.
7. Deliver → Return → genuine later Deliver: revenue/product cost restore, previously incurred shipping/gift/packaging charges occur once. Replay older courier progress: terminal status stays unchanged.
8. Concurrent delivery syncs and different orders sharing inventory must preserve all movements with no duplicate financial recognition.
9. Inject a ledger failure in the isolated test suite: stock, allocations and saved return status all roll back. Do not inject production failures.
10. Test an unambiguous Ameex order reference, ambiguous references and a nonmatching store. Real conversion rates are required across currencies; missing rates must yield 503 without writes.
11. Read processed details using GET by return ID repeatedly; no new ReturnRequest is created. Returns tiles should count component units and actual losses.

## Live test discipline

Use clearly labelled synthetic products/orders. No real dispatch or customer message is needed for allocation API checks. Correct conditions to GOOD, remove synthetic stock, archive QA products and deactivate QA categories afterwards. Retain the labelled order/return audit history; preserve the test account and original connected catalog.

Remaining provider acceptance: print a real courier test label, inspect actual product/pack codes and quantities, scan the physical barcode, and confirm actual callback delivery. Synthetic snapshots and server-side QR tests do not certify the camera or printed ticket. Courier-specific Lost/Damaged vocabulary and multi-currency fees need actual provider contract examples. WhatsApp delivery still needs client Meta setup.


## Retest evidence after the fixes

Use the latest linked report. All 97 recorded live checks passed. The temporary QA store from the audit has been deleted successfully, so its IDs are historical fixtures and must not be reused. The original QA account and earlier retained order remain available. A disposable staff user is deactivated and scheduled for the normal deletion grace period.

The regression tests now cover oversized amounts and computed costs, legacy/new manual-order retry conflicts, staff financial access, explicit store deletion with journals/bundles/gifts/expenses, confirmed provider cancellation and authenticated absence of pending parcels. The real QuickLivraison connectivity probe returns 200; this is separate from a genuine Delivered/Returned parcel event.
