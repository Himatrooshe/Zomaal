# Frontend Developer Guide — Expenses

Updated 19 October 2026.

## References

- Figma: [Expenses (Figma section 1:7802)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/09-expenses.md).
- [OpenAPI contract](../../api/openapi.yaml).

## Backend status

Manual/system expenses and ad-spend aggregation exist. Courier fees affect order financials but were not found in the Expenses Shipping-group summary.

## Main flow

Summary/trends; date filters; expense list/detail; create/edit/delete manual categories; receipts.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.



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

## Updated fix contract

- Send a stable `Idempotency-Key` header (or body `idempotencyKey`) when creating an expense. Reuse it only for a retry of that creation. Generate a fresh key for a new expense. Handle 409 for changed data or a retry after deletion. PATCH does not accept a creation key.
- Send `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` on calendar-day filters, chart queries and date-only expense entry/edit. For timestamps, send ISO with an explicit offset or Z. Omitted timezone retains UTC compatibility.
- Use only OTHER categories for manual expense creation/reassignment. Source groups are read-only.
- Amount strings have at most 16 integer digits and two fractional digits, and must be positive. Required fields cannot be cleared with null; notes/receiptUrl can be cleared. Clear an uploaded receipt with `receiptUrl: null`.
- Summary and Home Expenses now include courier financial ledger costs. Their timestamp is the financial-event time. Missing conversion rates are returned in `unconvertedShippingCosts`; preserve them as unknown rather than displaying invented zero costs.
- The shipping summary is derived data. `GET /expenses?group=SHIPPING` still lists actual stored Expense rows, just as ADS spend is separate from manual expense rows. Inspect source order financials for courier-fee details.
