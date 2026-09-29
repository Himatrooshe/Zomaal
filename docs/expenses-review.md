# Expenses completeness review

Reviewed the current Expenses service, controller, DTOs, receipt storage, Salary integration, advertising snapshots, purchase records, and the documented Expenses screen flows. Status: **core safety fixes are now implemented; provider-backed aggregation remains open**.

## Findings

1. **High — automatic cost sources are missing from totals and charts.** `ExpensesService.summary()` and `trend()` read only `Expense`. Salary confirmation creates those rows, but advertising writes `AdsMetricSnapshot`, purchases write `MerchantPurchase`, and shipping costs live in shipment/financial records. There is no aggregation or ingestion joining these sources into Expenses. The documented Shipping / Advertising / Purchases groups therefore do not automatically reflect those modules. Define one source per group, currency conversion and recognition rules, and exclude duplicate manual entries before connecting them. References: `src/expenses/expenses.service.ts:270`, `src/ads/tiktok/tiktok-ads-sync.service.ts:111`, `src/zomaal-shop/purchases.service.ts:209`, `src/ecommerce/ecommerce-order-financial.service.ts`.

2. **Fixed — receipt replacement now attaches the new upload before cleaning the old one.** A failed or expired replacement leaves the old receipt intact. Deletion also removes the media only after the expense row succeeds.

3. **Fixed — system-managed groups are protected.** Custom SHIPPING, ADS, PURCHASES and SALARY categories are rejected, and system categories cannot be moved between groups.

4. **Fixed — date-only `dateTo` includes the full UTC day.** Explicit timestamps remain exact timestamps.

5. **Medium — manual expense submissions are not retry safe.** `POST /expenses` always inserts a row and has no idempotency key. A timed-out request retried by the client can double-count an expense (or fail on an already-attached receipt). Add store-scoped request deduplication with payload-conflict detection. Reference: `src/expenses/expenses.service.ts:345`.

6. **Fixed — added store-scoped `GET /expenses/:expenseId` for the detail screen.**

## Working coverage

Store scoping and module permission guards, manual entry/edit/delete, categories, receipt upload/read, list/search/pagination, group totals and monthly chart over the current Expense ledger are implemented. The Staff integration creates one linked expense per confirmed automatic salary and supports later recording for manual salaries. Linked salary expenses are protected against direct editing/deletion and expose their source salary ID.

Validation run: **27 tests passed** across Expenses and permission guards. These tests establish the existing coverage; they do not cover all findings above. For example, one existing receipt replacement test explicitly expects the unsafe delete-before-attach ordering.

This review did not change Expenses behavior or invent provider costs. The automatic-source accounting decisions and the fixes above remain implementation work.
