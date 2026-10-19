# QA Tester Guide — Purchases

Updated 19 October 2026.

## References

- Figma: [Purchases (Figma section 1:4656)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/07-purchases.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Current status

Manual product/packaging purchases, receipts, stock/expense sync and supplier/invoice recording are deployed in `54e1048`. All six reported findings passed the production retest: **284 recorded checks passed, zero failed**. See [live results](./live-fix-retest-2026-10-20.md) and [API contract changes](./fix-verification-2026-10-20.md). Client Google Doc Q7.4 requires supplier selection from the product and invoice recording; the API now supports them.

## Main flow

Create product or packaging purchase; select stock behavior and a configured supplier; record the invoice; confirm linked expense and inventory ledger; attach receipt/note.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Verify purchase types, add-to-stock switch, expense sync/no double-counting, receipt handling, and supplier/invoice requirement against the client answer before signoff.


## Historical live audit handoff — before the fixes

- [Results and reproduction evidence](./live-server-test-results-2026-10-20.md): 82 relevant unit tests passed, with six live/requirements findings still open.
- Retest concurrent quantity edits against stock, receipt upload/attachment, mixed-currency groups, money overflow and null PATCH fields after fixes.
- Main sequential workflows, expense protections, variant stock, damaged/reserved/consumed stock conflicts, staff view-only access and store isolation passed.
- Receipt lifecycle remains blocked by a database constraint; Shop delivery was covered only by existing unit tests in this pass.
- All temporary purchase/store records removed; original account preserved.

## Historical local verification phase

The findings above describe the earlier live version. [Fix verification](./fix-verification-2026-10-20.md) documents all six local fixes, supplier/invoice fields, currency-qualified group keys, receipt lifecycle tests and required live retests. Use that contract after deployment. Do not replace the historical production failures with local pass results.

## Current production status — 20 October 2026

All six reported Purchases findings are deployed in `54e1048` and passed **284 recorded live checks**. [Production results and actual responses](./live-fix-retest-2026-10-20.md) supersede the pending-deployment notes above. Use the supplier/invoice and currency-group contract in the fix verification. Receipt expiry, actual Shop fulfillment and mobile UI acceptance retain the limits listed in the production report.
