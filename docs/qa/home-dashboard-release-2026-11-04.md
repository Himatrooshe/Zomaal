# Home dashboard backend — production release

Verified 4 November 2026 against `https://zomaal-backend-563898960389.us-central1.run.app` using the supplied merchant QA account (phone ending 0654). Frontend code and UI acceptance are outside this release.

## Deployed code

- `c2feefd7ee98235b09289683976235e5a95fd287`: expense category totals, summary currency, and consistent All time defaults.
- `923b4d7df8cdd0ee75f1f940e9cf93696907dabb`: UTC date boundaries and corrected timezone grouping, discovered through populated live testing.
- [Final CI and production deployment](https://github.com/Himatrooshe/Zomaal/actions/runs/41835489793): completed successfully for `923b4d7`, including production health smoke testing.

No schema migration or dependency change was introduced.

## API contract

`GET /expenses/summary` now includes:

```json
{
  "currency": "MAD",
  "byCategory": [
    { "categoryId": "<category UUID>", "name": "Packaging", "group": "OTHER", "total": "12.34" }
  ]
}
```

Existing `totalAmount`, `byGroup`, and unconverted-cost fields retain their calculations. Category totals represent recorded expense rows; tracked ads and courier ledger fees remain in group/grand totals. Retain the Packaging category ID when its name changes. Operational cost can be derived as OTHER minus the chosen Packaging category total. Absent categories have zero recorded spend in the period.

Omitting dates now means All time on Home, orders status summary, returns summary, expense summary, and ad spend. This intentionally replaces the previous current-month default on the three ecommerce dashboard routes. Send explicit dates when a current-month view is needed. Ecommerce routes use `from`/`to`/`timezone`; expense routes use `dateFrom`/`dateTo`/`timezone`.

Calendar-day boundaries are resolved with the existing DST-aware UTC conversion helper. Revenue, profit, order buckets, and returns filter order dates consistently; Home operating expenses and expense summaries use matching local-day boundaries. Advertising retains provider daily snapshot dates rather than reconstructing unavailable intraday data.

## Verification

- Local unit tests: **146 suites, 1,442 tests passed**.
- Local PostgreSQL Expenses workflow: **61 tests passed**, including historical profit/orders/returns, category rename and store isolation, local midnight boundaries, delivered revenue, and daily chart grouping on the New York DST transition date.
- Build and generated OpenAPI passed. Changed files passed formatting. Production code and the PostgreSQL test file passed targeted lint. The two existing unit-test files retain their prior lint errors; comparison found no added violations.
- Final CI passed all configured unit, PostgreSQL workflow, build, and deployment checks.
- Production: **89 assertions across 119 HTTP requests passed**. [Sanitized request/assertion results](home-dashboard-live-results-2026-11-04.json).

Live checks covered health, deployed OpenAPI, all five source endpoints for the six dial views, Today, Yesterday, rolling 7D/30D, a custom range in America/New_York, All time, and an upper-bound-only range. Missing authentication, reversed ranges, impossible dates, invalid timezones, and unknown query parameters returned the expected errors.

Populated expense fixtures verified exact category sums, stable IDs after rename, grand/group totals, net profit changes, unchanged order profit, and inclusion of previous-month expenses in All time. Dhaka's early morning was correctly included in its local day while excluded from the same UTC day. The New York DST test included the opening midnight and final millisecond of its 23-hour day, and excluded records immediately before and at the following midnight.

All **eight temporary expenses and two temporary categories were deleted**. Expense totals, profit totals, and fixture-category absence were checked against the original baselines for all tested fixture ranges after cleanup. Credentials and tokens are excluded from the committed evidence.

The merchant's existing order, return and advertising data did not provide populated live provider buckets. Those routes passed live response/schema/range checks; populated order/return accounting was verified in PostgreSQL and CI. No real courier dispatch or advertising-provider mutation was performed.

The first populated live run on `c2feefd` exposed a Home timezone mismatch and cleaned up its fixtures. It was corrected in `923b4d7`; the successful final run above was performed after that deployment. The [original review](home-dial-backend-review-2026-11-04.md) records the initial findings and correction.
