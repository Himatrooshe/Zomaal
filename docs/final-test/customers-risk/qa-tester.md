# QA Tester Guide — Customers and Risk Center

## Handoff status — 22 October 2026

The detailed Customers & Risk Center handoff records `0e7d246` and 342/342 passing live observations. Use that handoff for normalized phone identity, duplicate decisions, permissions and warning-only blacklisting. This folder is an alternate entry to the same module, not a separate implementation.

[Verification evidence](./../customers-risk-center/fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Blacklist (Figma section 1:9058), Customers (1:10379), Duplicate Orders (1:17490)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/11-customers-risk.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Search customer; inspect order history/risk; blacklist/unblacklist; review duplicate orders; cancel or keep.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test normalized phone identity, product-aware duplicate matching, concurrent keep/cancel decisions, warning-only blacklisting, data redaction and store isolation. Do not expect blacklist to cancel or refuse orders automatically.

## Detailed current handoff

Use [customers-risk-center](../customers-risk-center/README.md), [frontend contract](../customers-risk-center/frontend-developer.md), and [QA regressions](../customers-risk-center/qa-tester.md). These describe the same module and supersede this entry's earlier generic checklist.
