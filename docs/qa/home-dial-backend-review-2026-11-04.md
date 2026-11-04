# Issue #6 — Home dashboard backend review

Initial review: 4 November 2026. The findings below describe the original deployment. The subsequent backend implementation adds expense summary currency/category totals and makes omitted dates consistently mean All time. Frontend code is outside this work.

## Backend implementation

- Expense summary now returns `currency` and `byCategory: [{ categoryId, name, group, total }]` without changing existing group or grand-total calculations. Category IDs remain stable after renaming. Tracked ad spend and courier ledger fees are not duplicated into category totals.
- Home, order status summary and returns summary now interpret omitted dates as unbounded, matching expense summary and ad spend. This intentionally changes their previous implicit current-month default. Consumers needing the current month must send its explicit dates.
- Updated endpoint descriptions, generated OpenAPI, and module handoff documentation.
- No schema migration or dependency change is required. Rollback is a code revert; clients should tolerate the additive expense fields being absent after rollback.
- Local verification: 146 unit suites / 1,442 tests passed; build and OpenAPI generation passed. Formatting passed for all changed TypeScript files. Lint comparison against HEAD found no added violations; two existing unit-test files retain 29 pre-existing errors in total.
- PostgreSQL workflow verification uses a dedicated local database. Production verification and deployment evidence are recorded separately after release.

## Result

The five existing routes support the data sources for the six dial views. No additional dial-specific route is necessary. The separate Packaging card is not supported by the current expense summary response. The report's backend limitation is correct; complete issue acceptance is not established by this review.

## Findings

1. **Position 5 cannot separate Packaging from Operational cost using `/expenses/summary`.** `ExpensesService.summary` selects only expense amounts and category groups, returning `totalAmount`, `byGroup`, and unconverted-cost lists. It exposes no category IDs, names, or category totals. A backward-compatible category breakdown would allow consumers to identify packaging expenses and subtract them from OTHER without replacing existing group totals. A stable definition of which category represents Packaging is also needed; category names are merchant-editable. Existing category and expense-list routes can supply category-level information, so this is specifically a summary-contract gap.

2. **Omitting dates produces inconsistent periods across the dashboard routes.** `/ecommerce/home`, `/ecommerce/orders/status-summary`, and `/ecommerce/returns/summary` default to the current calendar month. `/expenses/summary` and `/expenses/ad-spend` leave the range unbounded. Live requests with only `timezone=Asia/Dhaka` returned ecommerce periods of `2026-11-01` through `2026-11-04`; expense code applies no date restriction. Consequently, an All time selection cannot consistently use empty date parameters. Supplying `to=2026-11-04` / `dateTo=2026-11-04`, omitting the lower bound, and retaining timezone successfully requests all history through that date. Preserve the documented current-month behavior unless an explicit contract change is agreed. The shared RevenueRangeQueryDto descriptions say omission means all time, which is misleading for these three routes and should be clarified.

3. **Expense summary does not expose its currency.** Values are in store currency, but `ExpenseSummaryResponseDto` has no `currency` field, unlike orders, returns, and ad spend. Consumers must obtain it from `/ecommerce/home.baseCurrency` or store metadata. A backward-compatible `currency` field would make Positions 3 and 5 independent of revenue presence. The issue's example operations interface includes a currency field that the backend does not currently return.

4. **The issue's revenue example does not match the actual response schema.** Revenue totals use `grossSales`, `discounts`, `refunds`, `netSales`, `shipping`, `tax`, and `totalCollected`, with currency and order count. There is no `totalDelivered` property. Delivered-only eligibility is implemented by the revenue query; consumers must map the actual money fields. `/ecommerce/home.profit.value` is the net-profit source, independent of revenue rows.

## Confirmed backend behavior

- Overview supplies `baseCurrency`, delivered revenue, net profit, order profit, ad spend, operating expenses, and lost-order counts/value. Net profit is order profit minus ad spend minus operating expenses.
- Orders supplies delivered, in-delivery, refused, and cancelled counts/value.
- Logistics can combine expense SHIPPING/ADS groups, Home lost-order value, and returns damaged value.
- Ad spend supplies platform breakdowns from tracked campaign snapshots. An absent platform need not have a row; an empty breakdown is valid.
- Returns supplies received, pending, damaged, and missing item counts/value.
- Ecommerce routes accept `from`, `to`, `timezone`; expense routes accept `dateFrom`, `dateTo`, `timezone`. Sending identical parameter names to every route is not the current contract.
- Recorded expense dates use the requested timezone. Ad metrics retain provider daily snapshot dates; timezone does not reallocate already aggregated ad days.

## Live verification

Target: production API `https://zomaal-backend-563898960389.us-central1.run.app`, supplied merchant QA account (phone ending 0654).

45 read requests: each of the five routes against nine cases.

| Case | Dates / timezone | Result on all five routes |
| --- | --- | --- |
| Today | 2026-11-04, Asia/Dhaka | 200 |
| Yesterday | 2026-11-03, Asia/Dhaka | 200 |
| Rolling 7D | 2026-10-29 through 2026-11-04, Asia/Dhaka | 200 |
| Rolling 30D | 2026-10-06 through 2026-11-04, Asia/Dhaka | 200 |
| Custom | 2026-10-15 through 2026-10-22, America/New_York | 200 |
| Dates omitted | Asia/Dhaka only | 200; inconsistent defaults as described above |
| All history through today | Upper bound 2026-11-04 only, Asia/Dhaka | 200; ecommerce lower bound null |
| Reversed range | 2026-11-04 through 2026-11-01 | 400 |
| Invalid timezone | Invalid/Zone | 400 |

The supplied account returned zero dashboard amounts/counts for these checks. These results establish response availability, validation, and returned ecommerce periods; they do not prove nonzero financial reconciliation, populated category splits, or records crossing timezone boundaries. No synthetic production transactions were created.

Sanitized local request evidence: `/private/tmp/zomaal-issue06-backend-results.json`. Audit script: `/private/tmp/zomaal-issue06-backend-audit.cjs`. Credentials and tokens are excluded from both files.

## Local verification

```sh
npm test -- --runInBand ecommerce/ecommerce.service.spec.ts expenses/expenses.service.spec.ts ecommerce/ecommerce-order-financial.service.spec.ts
```

Result: **3 suites passed, 63 tests passed**. Financial-service fixtures emit COD synchronization errors while the tests pass; this is not evidence of a production API failure. PostgreSQL workflow suites, build, and lint were not run for this read-only review.

Relevant code: `src/expenses/expenses.service.ts` (summary and ad date mapping), `src/expenses/dto/expense.dto.ts` (summary schema), `src/ecommerce/ecommerce.service.ts` (Home and date defaults), `src/ecommerce/dto/revenue-query.dto.ts` (shared query descriptions), `src/ecommerce/dto/ecommerce-response.dto.ts` (revenue fields).
