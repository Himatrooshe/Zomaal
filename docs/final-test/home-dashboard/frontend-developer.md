# Frontend Developer Guide — Home Dashboard

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

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Current API integration notes

Use `GET /ecommerce/home` and the published revenue/returns/financial endpoints. Revenue counts delivered orders; lost includes cancelled and returned. Net profit includes ad spend and other expenses without subtracting courier losses twice. Keep unsupported FX/unknown costs visible. Reconcile date/timezone changes against source-module totals; no full dashboard UI signoff is implied by account-preservation snapshots.
