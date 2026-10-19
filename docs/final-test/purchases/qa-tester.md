# QA Tester Guide — Purchases

Updated 19 October 2026.

## References

- Figma: [Purchases (Figma section 1:4656)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/07-purchases.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Current status

Manual product/packaging purchases and stock/expense sync exist. The 20 October live audit found six unresolved issues; final production signoff is pending. All six findings are now fixed and verified locally; see [fix verification](./fix-verification-2026-10-20.md) for the new contract and deployment status. Original client Google Doc Q7.4 confirms supplier selection from the product and invoice recording are required; the opposite local module answer is stale. See [live audit](./live-server-test-results-2026-10-20.md).

## Main flow

Create product or packaging purchase; select stock behavior; confirm linked expense and inventory ledger; attach receipt/note.

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


## Live audit handoff — 20 October 2026

- [Results and reproduction evidence](./live-server-test-results-2026-10-20.md): 82 relevant unit tests passed, with six live/requirements findings still open.
- Retest concurrent quantity edits against stock, receipt upload/attachment, mixed-currency groups, money overflow and null PATCH fields after fixes.
- Main sequential workflows, expense protections, variant stock, damaged/reserved/consumed stock conflicts, staff view-only access and store isolation passed.
- Receipt lifecycle remains blocked by a database constraint; Shop delivery was covered only by existing unit tests in this pass.
- All temporary purchase/store records removed; original account preserved.

## Local fixes ready — deployment pending

The findings above describe the earlier live version. [Fix verification](./fix-verification-2026-10-20.md) documents all six local fixes, supplier/invoice fields, currency-qualified group keys, receipt lifecycle tests and required live retests. Use that contract after deployment. Do not replace the historical production failures with local pass results.
