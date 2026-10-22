# Frontend Developer Guide — Purchases

## Handoff status — 22 October 2026

All six findings were fixed in `54e1048` and passed 284/284 recorded live checks: stock concurrency, receipt constraints, currency-qualified groups, money bounds, null PATCH validation and supplier/invoice recording. Later Shop delivery accounting fixes are documented in the Shop handoff. Natural receipt expiry and actual carrier fulfillment retain their stated limits.

[Verification evidence](./live-fix-retest-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Purchases (Figma section 1:4656)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/07-purchases.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Create product or packaging purchase; select stock behavior and a configured supplier; record the invoice; confirm linked expense and inventory ledger; attach receipt/note.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.


## Current integration contract

- Configure catalog `supplierNames`; select a supplier from `/purchases/product-options`. Send optional `supplierName` and `invoiceNumber` snapshots; do not invent a supplier or backfill historical invoices.
- Keep returned group keys opaque. New keys qualify currency; legacy mixed groups expose `totalCostByCurrency` and nullable combined amounts.
- Receipt upload/replacement/clear passed deployed retesting. Reject foreign, reused or expired assets without partial writes.
- Omit unchanged PATCH fields. Only supported nullable fields such as notes/receiptAssetId may be cleared; null price, quantity, date or payment method returns 400.
- Concurrent edits/deletes reconcile stock and linked Expenses from the transaction's current purchase. A bounded-retry conflict may return 409; refetch before resubmitting.
- Purchase creation has no general creation-idempotency contract: reconcile through reads after an uncertain submission rather than blindly repeating it.
- The [initial audit](./live-server-test-results-2026-10-20.md) is historical. The [deployed report](./live-fix-retest-2026-10-20.md) and [field contract](./fix-verification-2026-10-20.md) supersede its six failures.

## Current production status — 20 October 2026

All six reported Purchases findings are deployed in `54e1048` and passed **284 recorded live checks**. [Production results and actual responses](./live-fix-retest-2026-10-20.md) supersede the pending-deployment notes above. Use the supplier/invoice and currency-group contract in the fix verification. Receipt expiry, actual Shop fulfillment and mobile UI acceptance retain the limits listed in the production report.
