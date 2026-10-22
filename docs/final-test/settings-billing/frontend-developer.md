# Frontend Developer Guide — Settings, Multi-store, Plans, and Billing

## Handoff status — 22 October 2026

Store settings/switching, isolation, trial entitlements and billing guards were exercised: 33/34 observations passed. The failed acceptance check is the empty active-plan list, which leaves Pricing without options. Approved admin-managed plans must be configured. Gateway/web checkout and stored card methods are not implemented; full paid/expired/suspended plan acceptance and deletion-grace execution remain open.

[Verification evidence](./live-server-results-2026-10-21.json) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Plans and Pricing (Figma section 1:13513), Settings/Profile (1:10566)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/17-settings-billing.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

View/update profile/store; select store; view plan/trial; confirm read-only after expiry; manual admin activation where authorized.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The log distinguishes verified local tests from deployment and live retest. Historical module observations above keep their original date and scope.
