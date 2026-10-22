# Frontend Developer Guide — Customers and Risk Center

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

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Detailed current handoff

Use [customers-risk-center](../customers-risk-center/README.md), [frontend contract](../customers-risk-center/frontend-developer.md), and [QA regressions](../customers-risk-center/qa-tester.md). These describe the same module and supersede this entry's earlier generic checklist.
