# QA Tester Guide — Products, Bundles, and Compare

## Handoff status — 22 October 2026

All five product-edit findings were fixed in `6f8d8d4`, deployed and retested: 60/60 live observations passed. Image replacement/removal, nullable description, blank names and unused-variant removal are corrected. Real inventory/purchase history still protects used variants. Broader provider/import, performance, currency and device acceptance retain the limits in the report.

[Verification evidence](./fix-verification-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Products (1:6392), Add Products and Bundle (1:6893), Compare Products (1:9527)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/05-products.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

List/filter; create/edit products and variants; inventory updates; bundles; compare platform products.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test variants/SKUs, stock reservation and delivery, bundle cost/availability, image nullability, imports and matching, compare responses, and store isolation.
