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
Answer:

**Q9.2 — Shipping cost source**
Should we use the actual fee from the courier API, or a per-city rate the merchant enters? What about orders shipped outside Zomaal?
Assumption: the courier API fee when available, otherwise a default fee the merchant sets per courier.
Answer:

**Q9.3 — Recurring expenses**
Rent is monthly. Do we need "repeat every month" on manual expenses?
Assumption: not in v1.
Answer:

**Q9.4 — "Revenue" row in the Figma categories list**
One Figma state shows "Revenue — 0% of total expenses". Is that a design mistake?
Assumption: yes, and we will ignore it.
Answer:

**Q9.5 — Payment methods list**
Figma shows Cash and Bank. Is anything else needed (card, mobile wallet)?
Answer:
