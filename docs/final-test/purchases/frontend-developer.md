# Frontend Developer Guide — Purchases

Updated 19 October 2026.

## References

- Figma: [Purchases (Figma section 1:4656)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/07-purchases.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Backend status

Manual product/packaging purchases, receipts, stock/expense sync and supplier/invoice recording are deployed in `54e1048`. All six reported findings passed the production retest: **284 recorded checks passed, zero failed**. See [live results](./live-fix-retest-2026-10-20.md) and [API contract changes](./fix-verification-2026-10-20.md). Client Google Doc Q7.4 requires supplier selection from the product and invoice recording; the API now supports them.

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


## Historical live audit handoff — before the fixes

- [Results and current limitations](./live-server-test-results-2026-10-20.md). Six findings remain open; do not mark this module accepted.
- Supplier/invoice fields are a confirmed client requirement but have no supported purchase API contract yet. Sending guessed field names returns 400.
- Receipt upload currently returns 500; show an actionable failure without claiming an attachment was saved.
- Group totals can incorrectly combine currencies even though summary totals separate them. Do not present such group totals as trusted converted amounts.
- Omit unchanged PATCH properties; send `notes: null` or `receiptAssetId: null` only to clear those supported fields. Null price currently returns 500 and null date changes history to 1970. Backend validation still needs fixing.
- Prevent overlapping saves as a UI precaution; server concurrency safety remains required. Preserve the form on failure and avoid blind retries of purchase creation, which has no request idempotency contract.
- Warehouse product cost fields are numeric; purchase and expense money are formatted strings.

## Historical local verification phase

The findings above describe the earlier live version. [Fix verification](./fix-verification-2026-10-20.md) documents all six local fixes, supplier/invoice fields, currency-qualified group keys, receipt lifecycle tests and required live retests. Use that contract after deployment. Do not replace the historical production failures with local pass results.

## Current production status — 20 October 2026

All six reported Purchases findings are deployed in `54e1048` and passed **284 recorded live checks**. [Production results and actual responses](./live-fix-retest-2026-10-20.md) supersede the pending-deployment notes above. Use the supplier/invoice and currency-group contract in the fix verification. Receipt expiry, actual Shop fulfillment and mobile UI acceptance retain the limits listed in the production report.
