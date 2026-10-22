# Purchases

## Handoff status — 22 October 2026

All six findings were fixed in `54e1048` and passed 284/284 recorded live checks: stock concurrency, receipt constraints, currency-qualified groups, money bounds, null PATCH validation and supplier/invoice recording. Later Shop delivery accounting fixes are documented in the Shop handoff. Natural receipt expiry and actual carrier fulfillment retain their stated limits.

[Verification evidence](./live-fix-retest-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [07-purchases.md](../../module-context/07-purchases.md)
- API schemas and routes: [OpenAPI](../openapi.production.json)


## Live audit — 20 October 2026

**Historical live result: six findings in the deployed version. All six are now deployed and passed the live retest.** See [live test results](./live-server-test-results-2026-10-20.md) and [sanitized observations](./live-server-results-2026-10-20.json). Stock concurrency, receipts, mixed currencies, money bounds, null PATCH fields and supplier/invoice requirements need fixes.

## Fix verification — 20 October 2026

All six findings are implemented, deployed and retested live. See [fix verification and rollout](./fix-verification-2026-10-20.md). The earlier live audit records the deployed version before these fixes.

## Production retest — 20 October 2026

**284 recorded checks passed, zero failed.** Code `54e1048` is deployed with 100% traffic. [Live results and response excerpts](./live-fix-retest-2026-10-20.md). The original live audit and local verification are preserved as historical evidence.
