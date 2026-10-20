# Expenses

- [Deployed fix verification](./fix-verification-2026-10-20.md)
- [Live retest evidence and responses](./live-fix-retest-results-2026-10-20.json)
- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- [Confirmed client requirements](../../module-context/09-expenses.md)
- [Published OpenAPI](https://github.com/Himatrooshe/Zomaal/blob/main/docs/api/openapi.yaml)

## Current status — 20 October 2026

Fix `639a58b` deployed as revision `zomaal-backend-00064-jbb`. **362/362 live observations passed.** All ten reproduced finding groups passed live retesting; courier-cost aggregation is implemented and passed PostgreSQL tests. Real nonzero courier billing and populated ad-account acceptance remain unverified live because the retained account has zero courier fees and no ad accounts.

The [initial audit](./live-server-test-results-2026-10-20.md) and [original evidence](./live-server-results-2026-10-20.json) describe the pre-fix revision. Original QA data/account preserved; temporary fixtures and cloud receipt images cleaned.
