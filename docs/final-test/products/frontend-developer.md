# Frontend Developer Guide — Products, Bundles, and Compare

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

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The fixes are deployed on `zomaal-backend-00073-c2b` and passed 79/79 live observations; the log records both local and deployed evidence. Historical module observations above keep their original date and scope.
