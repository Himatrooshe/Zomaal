# 9. Expenses

## Screens
Expenses (total, % vs last month, All / This month / Last month / Custom, chart, categories: Shipping
costs, Ad spend, Staff salary, Purchase costs, Other) · Breakdown (pie) · Other expenses list · Expense
details (amount, category, date, payment method, note, receipt) · Add expense (category: Bills, Supplies,
Marketing, Employee salary, + create) · Create category.

## Data flow (as Figma shows it)
Four categories fill **automatically** from other modules:

| Category | Source |
|---|---|
| Shipping costs | Shipping (tab 13) |
| Ad spend | Advertising (tab 14) |
| Staff salary | Staff salary payments (tab 10) |
| Purchase costs | Purchases (tab 7) |
| Other | Entered manually by the merchant |

**Purchase costs (built):** every purchase creates its own expense automatically (see tab 7). Adding an
expense to a "Purchase costs" category, or moving one into it, is refused with 409. Purchase expenses
can't be edited or deleted here; change the purchase instead. Expense responses carry `purchaseId` and
`isPurchaseGenerated` so the app can show them read-only.

**Ad spend (built):** calculated live from synced ad metrics, never stored as expense records. Platforms revise
recent days, and a copy would drift from the real numbers.
- What counts: only tracked (selected) campaigns. A disconnected account keeps its past spend.
- Where it shows: the ADS group in `GET /expenses/summary` and the monthly `GET /expenses/trend`.
- Breakdown: `GET /expenses/ad-spend?dateFrom&dateTo` lists spend by platform and by ad account (the "Ad spend" category screen).
- Currency: each account's spend is converted to the store currency with the live rate. If no rate is available, that spend is left out of the totals and listed under `unconvertedAdSpend` / `unconverted`. It is never guessed.
- Dates: ad spend is daily, so date-times in the filters are widened to whole days.
- `GET /expenses?group=ADS` returns no rows, because there are no ADS expense records.

## Questions

**Q9.1 (blocker) — Double counting**
The Add Expense list includes "Employee salary" and "Marketing". If a merchant adds salary manually while
staff salary is automatic, it counts twice. Should the manual list only allow "Other" sub-categories?
Assumption: manual expenses always go under Other. The automatic groups are read-only.
Answer: Confirmed: automatic staff salaries cannot be entered manually again; bonuses belong in Other expenses.

**Q9.2 — Shipping cost source**
Should we use the actual fee from the courier API, or a per-city rate the merchant enters? What about orders shipped outside Zomaal?
Assumption: the courier API fee when available, otherwise a default fee the merchant sets per courier.
Answer: Confirmed: use shipping costs from the courier service API.

**Q9.3 — Recurring expenses**
Rent is monthly. Do we need "repeat every month" on manual expenses?
Assumption: not in v1.
Answer: Confirmed: do not create automatic monthly recurring expenses in v1.

**Q9.4 — "Revenue" row in the Figma categories list**
One Figma state shows "Revenue — 0% of total expenses". Is that a design mistake?
Assumption: yes, and we will ignore it.
Answer: Confirmed: the Revenue expense-category row is a design mistake; revenue is calculated separately.

**Q9.5 — Payment methods list**
Figma shows Cash and Bank. Is anything else needed (card, mobile wallet)?
Answer: Client decision pending. CASH and BANK are the current temporary supported methods; additional methods must follow the later client decision.


## Production audit — 20 October 2026

Original client answers above were read directly from the shared Google Doc. Expenses live audit: **345 observations, 313 passed, 32 failed assertions** across ten live finding groups. A separate code review confirms missing courier-cost aggregation, without nonzero live courier fees to reproduce its amount. See [results and actual responses](../final-test/expenses/live-server-test-results-2026-10-20.md). No application fixes or deployment occurred in this audit. Existing Cash/Bank support is temporary while the client decides other payment methods; the chart currently uses UTC although the client requested the phone timezone.


## Deployed fix verification — 20 October 2026

Commit `639a58b`, serving revision `zomaal-backend-00064-jbb`: **362/362 live observations passed** after CI/CD. Receipt lifecycle, validation, manual source-group guards, durable retry keys and phone-timezone support are implemented. Courier costs now aggregate from signed order financial events into Expenses/Home expense totals without a second profit deduction; missing conversion rates are exposed. All ten original API/requirements finding groups passed live retesting. Positive courier-fee/FX scenarios passed PostgreSQL tests; actual nonzero courier/ad-provider acceptance still needs real source data. See [fix verification](../final-test/expenses/fix-verification-2026-10-20.md). Prior audit status above is historical.
