# QA Tester Guide — Settings, Multi-store, Plans, and Billing

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

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test store-switch isolation, entitlements, trial boundaries, cancel/resume, expired read-only state, admin activation, and ensure no mock checkout reports success.
