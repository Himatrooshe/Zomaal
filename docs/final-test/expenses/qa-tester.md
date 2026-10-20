# QA Tester Guide — Expenses

Updated 19 October 2026.

## References

- Figma: [Expenses (Figma section 1:7802)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/09-expenses.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Current status

Manual/system expenses and ad-spend aggregation exist. Courier fees affect order financials but were not found in the Expenses Shipping-group summary.

## Main flow

Summary/trends; date filters; expense list/detail; create/edit/delete manual categories; receipts.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Test manual/system group rules, receipts, trend/date boundaries, ad spend, and confirm courier fees appear in Shipping total.



## Executed production audit — 20 October 2026

**345 observations: 313 passed, 32 failed assertions; ten live finding groups.** [Results, responses, limits and cleanup](./live-server-test-results-2026-10-20.md). The broader module is not signed off.

- Receipt replacement currently returns 500; replaying the current receipt ID returns 400. Preserve the displayed original receipt on failure.
- Avoid automatic POST retries: manual expense creation has no durable deduplication support; identical submissions can count twice.
- Money overflow/precision, null PATCH fields, blank names, malformed integer queries and calendar validation need backend fixes. Validate locally too, while retaining server validation as the authority.
- Treat SHIPPING/ADS/SALARY/PURCHASES as source-managed. The server currently fails to enforce this fully for SHIPPING/ADS.
- Normal manual CRUD, Purchases and Salary expense links, ordinary totals/Home profit, receipt upload/read/delete and store/role isolation passed live checks.
- The client requested the phone timezone; the chart is currently UTC with no timezone input. A phone-local October expense was counted in September.
- Actual nonzero courier/ads data and natural receipt expiry remain unverified live. Do not render missing conversion data as zero or fabricate a courier charge to demonstrate the screen.
- Client answers: automatic salary cannot be entered again manually; bonuses use OTHER; courier API supplies shipping costs; no automatic monthly recurrence. Additional payment methods await the client; CASH/BANK are temporary current options.
- Original account and ledgers preserved; temporary test records/store and two remaining cloud receipt images removed.
