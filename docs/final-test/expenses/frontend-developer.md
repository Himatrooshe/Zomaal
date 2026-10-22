# Frontend Developer Guide — Expenses

## Handoff status — 22 October 2026

Fix `639a58b` passed 362/362 production observations; all ten initial live finding groups passed retesting. Receipt lifecycle, durable creation retries, source-group protection, strict dates/amounts and device timezone are corrected. Courier ledger fees feed Expenses/Home; nonzero provider billing and populated ad-account acceptance remain limited by real data.

[Verification evidence](./fix-verification-2026-10-20.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Expenses (Figma section 1:7802)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/09-expenses.md).
- [OpenAPI contract](../openapi.production.json).

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


## Historical audit and current integration rules

The initial audit recorded ten live finding groups. Those findings passed the deployed retest; use [fix verification](./fix-verification-2026-10-20.md) for current responses. The [original report](./live-server-test-results-2026-10-20.md) preserves pre-fix failures.

- Receipt replacement and current-receipt replay now succeed; invalid replacements preserve the original attachment.
- Use a stable creation idempotency key for retries. Identical payloads create one charge; changed payloads and replay after deletion return 409. Requests without a key can create separate expenses.
- Manual creation/reassignment into SHIPPING, ADS, SALARY and PURCHASES is rejected. Use OTHER categories for manual expenses; bonuses use OTHER.
- Send the phone IANA timezone for date-only input, filters and charts. Explicit timestamp upper bounds are inclusive; date-only upper bounds include the full local day.
- Money bounds, required nulls, blank names, malformed pagination and invalid calendar dates return 400.
- Courier ledger costs feed summary/trend and Home without another profit deduction. Missing FX is explicit; stored SHIPPING expense rows are distinct from the derived courier summary.
- Real nonzero courier/ad-provider data and natural receipt expiry remain separate acceptance. CASH/BANK are current methods; additional methods await client decisions.

## Updated fix contract

- Send a stable `Idempotency-Key` header (or body `idempotencyKey`) when creating an expense. Reuse it only for a retry of that creation. Generate a fresh key for a new expense. Handle 409 for changed data or a retry after deletion. PATCH does not accept a creation key.
- Send `timezone: Intl.DateTimeFormat().resolvedOptions().timeZone` on calendar-day filters, chart queries and date-only expense entry/edit. For timestamps, send ISO with an explicit offset or Z. Omitted timezone retains UTC compatibility.
- Use only OTHER categories for manual expense creation/reassignment. Source groups are read-only.
- Amount strings have at most 16 integer digits and two fractional digits, and must be positive. Required fields cannot be cleared with null; notes/receiptUrl can be cleared. Clear an uploaded receipt with `receiptUrl: null`.
- Summary and Home Expenses now include courier financial ledger costs. Their timestamp is the financial-event time. Missing conversion rates are returned in `unconvertedShippingCosts`; preserve them as unknown rather than displaying invented zero costs.
- The shipping summary is derived data. `GET /expenses?group=SHIPPING` still lists actual stored Expense rows, just as ADS spend is separate from manual expense rows. Inspect source order financials for courier-fee details.


## Deployed live fix retest — 20 October 2026

Fix `639a58b`, revision `zomaal-backend-00064-jbb`: **362/362 production observations passed**. [Actual outcomes, responses, cleanup and limits](./fix-verification-2026-10-20.md). All ten initial API/requirements finding groups passed retesting. The audit section above is historical.

- Run creation retries with a stable key. Verify same-key identical data creates one charge, changed payload conflicts, deletion cannot be undone by a delayed retry, and body/header key mismatch is rejected.
- Send the device timezone for date-only create/edit, date filters and chart queries. Both UTC and offset timestamp ends are inclusive. Date-only ends include the full local calendar day.
- Receipt replacement/replay/clear and concurrent replacement now succeed; invalid or foreign replacement preserves the current receipt.
- Courier ledger fees feed Expenses and Home expense totals without a second profit deduction. Missing FX remains explicit. Actual positive courier billing and populated ad-provider data need separate real-provider acceptance; local ledger fixtures are not live courier bills.
- Full local checks: 1,184 units and 198 PostgreSQL tests passed. Repo-wide lint retains existing failures; scoped implementation/new-regression lint passed.
- [Published OpenAPI on main](https://github.com/Himatrooshe/Zomaal/blob/main/docs/api/openapi.yaml) contains the new retry/timezone and conversion-status contract.
