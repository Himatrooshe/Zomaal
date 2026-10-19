# Purchases

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [07-purchases.md](../../module-context/07-purchases.md)
- API schemas and routes: [OpenAPI](../../api/openapi.yaml)


## Live audit — 20 October 2026

**Historical live result: six findings in the deployed version. All six are now fixed locally; production signoff awaits deployment and retest.** See [live test results](./live-server-test-results-2026-10-20.md) and [sanitized observations](./live-server-results-2026-10-20.json). Stock concurrency, receipts, mixed currencies, money bounds, null PATCH fields and supplier/invoice requirements need fixes.

## Fix verification — 20 October 2026

All six findings are implemented and verified locally; production deployment and live retest are pending. See [fix verification and rollout](./fix-verification-2026-10-20.md). The earlier live audit records the deployed version before these fixes.
