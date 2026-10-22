# QA Tester Guide — Home Dashboard

## Handoff status — 22 October 2026

Delivered revenue, net profit after ad spend and other expenses, cancelled/returned lost orders, Ameex connection counting and exclusion of manual orders from remote catalog completeness are implemented in the deployed history. Expenses, Salary and Orders live reports check related Home totals and preservation; a complete dashboard/UI acceptance run is not recorded.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Home Screen (Figma section 1:13968)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/02-home-dashboard.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Dashboard reads orders, returns, shipping, ad spend, and expenses; date filters and device timezone affect the view.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Reconcile each card with its source module; test date boundaries, empty store, device timezone, currency conversion, null/unconverted values, and filter persistence.

## Current API integration notes

Use `GET /ecommerce/home` and the published revenue/returns/financial endpoints. Revenue counts delivered orders; lost includes cancelled and returned. Net profit includes ad spend and other expenses without subtracting courier losses twice. Keep unsupported FX/unknown costs visible. Reconcile date/timezone changes against source-module totals; no full dashboard UI signoff is implied by account-preservation snapshots.
