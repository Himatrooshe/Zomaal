# Frontend Developer Guide — Advertising

## Handoff status — 22 October 2026

Google and Meta Ads connection, campaign selection, metrics and status APIs are implemented; shared reads and scheduled spend sync feed Expenses/Home. The owner reports the remaining Facebook/Meta issue is client-side. Provider review/permissions and a working connected account still need acceptance; no populated-account end-to-end signoff is recorded here. TikTok and Snapchat are excluded from this QA pass even where source code exists.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Advertising screens (Figma sections 1:5586 and 1:12821)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/14-advertising.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Connect ad account; select campaigns; refresh metrics; pause/resume where permitted; reconcile spend in Home/Expenses.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Current API integration notes

Google and Meta endpoints include `/ads/{google|meta}/auth/start`, campaign reads/selection and status updates; shared reads are `/ads/connections`, `/ads/campaigns` and `/ads/statistics`. Google status values are PAUSED/ENABLED; Meta values PAUSED/ACTIVE. Respect read-only provider permissions and reconnect errors. Use store-currency converted spend from Expenses/Home; do not blindly label cross-account raw totals as one converted currency. Scheduled sync is implemented, but this refresh did not connect accounts or certify populated metrics.
