# Settings, Multi-store, Plans, and Billing

## Handoff status — 22 October 2026

Store settings/switching, isolation, trial entitlements and billing guards were exercised: 33/34 observations passed. The failed acceptance check is the empty active-plan list, which leaves Pricing without options. Approved admin-managed plans must be configured. Gateway/web checkout and stored card methods are not implemented; full paid/expired/suspended plan acceptance and deletion-grace execution remain open.

[Verification evidence](./live-server-results-2026-10-21.json) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

## Live status — 21 October 2026

Production store settings, store switching, trial entitlements, and billing
validation were checked on revision `zomaal-backend-00068-vbx`. A disposable
second store was removed and the original store restored. **One blocker remains:**
`GET /billing/plans` returns HTTP 200 with an empty list, so no plan can be
displayed or selected. See the [live test report](./live-server-test-results-2026-10-21.md).

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [17-settings-billing.md](../../module-context/17-settings-billing.md)
- API schemas and routes: [OpenAPI](../openapi.production.json)
- [Live server test results (21 October 2026)](./live-server-test-results-2026-10-21.md)

## Backend audit correction — 22 October 2026

See the [backend fix log](../../backend-live-audit-fixes-2026-10-22.md) for the new Store/Role/Category validation, accounting-currency protection and strict pagination/boolean contracts. The log distinguishes verified local tests from deployment and live retest. Historical module observations above keep their original date and scope.
