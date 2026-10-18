# 2. Home dashboard

## Screens
Home ("Your Latest Insights") · time range picker (Today / Yesterday / Last 7 days / Last 1 month / custom
calendar) · hide-values state · tooltips · empty state ("No order yet") · Trial ended / Subscription expired
overlays. The sidebar also shows Profit and Lost profit.

## Data flow (as Figma shows it)
Home only reads data; nothing is entered here. The cards pull from other modules:

| Card | Comes from |
|---|---|
| Total income / Orders count | Orders (tab 3) |
| Total confirm orders value | Orders with status "confirmed" |
| Revenue / Refunds / Refund cost | Orders + platform refunds |
| Total shipping cost / Avg shipping per order | Shipping (tab 13) |
| Total ad spend / Results / Avg cost per result | Advertising (tab 14) |
| Total expenses / Avg cost per order | Expenses (tab 9) |
| Profit / Lost orders (Lost profit) | Calculated |

**Built on `GET /ecommerce/home`:**
- `revenue` (Q2.1): only delivered orders count. "Delivered" comes from the order financial ledger, which the courier status (or the platform timeline for plugin shipping) drives. An order returned after delivery drops out again. `GET /ecommerce/revenue/summary` and `/revenue/timeseries` use the same rule, so the screens agree.
- `profit` (Q2.2):
  - `value` = `orderProfit` − `adSpend` − `operatingExpenses`.
  - `orderProfit` is the ledger: delivered revenue minus product, gift, packaging and shipping cost, damage and shipping losses.
  - `operatingExpenses` is recorded salary and other expenses. Purchases and shipping are left out because product cost and shipping are already in `orderProfit`.
  - `unconvertedCurrencies` lists order currencies left out because no exchange rate was available. Ad spend without a rate is listed in `ads.unconverted` and not subtracted.
- `lostOrders` (Q2.3): orders cancelled on the platform, plus orders whose courier reports the parcel cancelled, refused or returned (any return stage). Each order counts once; `value` is their net sales.
- `ads`: spend of tracked campaigns in the period (store currency), platform-reported results, cost per result, and any `unconverted` spend.
- `expenses`: `total` (all recorded expenses in the period + ad spend) and `avgPerOrder` (total ÷ orders in the period, null with no orders).

Every card filters by order date (`processedAt`) in the requested timezone, so delivered revenue, profit and lost orders describe the same set of orders. Expenses and ad spend filter by the date they were spent. The sales-drop notification still compares orders placed, so it is not delayed by delivery times.

Currency conversion never guesses. When no real rate is available (the last good rates are kept for 7 days), amounts are left out and listed as unconverted. Revenue totals keep them in their own currency, and dispatch refuses with 503 rather than send a wrong cash-on-delivery amount.

## Questions

**Q2.1 (blocker) — When does an order count as revenue?**
Options: when placed, when confirmed, or when delivered.
Assumption: revenue counts at **Delivered**, which matches the COD reality and the existing architecture doc.
"Total confirm orders value" is a separate card for confirmed orders that are not yet delivered.
Answer: when delivered.

**Q2.2 (blocker) — Profit formula**
Assumption: Profit = delivered revenue − product cost − shipping cost − ad spend − other expenses (salary, rent, and so on).
Should salary and other expenses be included, or should Home show gross profit only?
Answer: salary and other expenses included.

**Q2.3 — What is "Lost orders" / "Lost profit"?**
Is it the value of cancelled + refused + returned orders, or the money actually lost (shipping + return fees + damaged goods)?
Assumption: money actually lost (shipping + return costs + damage).
Answer: the order that was cancelled + returned from the parcel service API.

**Q2.4 — "Results" in ad spend**
Should we use the platform's own result metric (purchases or conversions as TikTok/Meta report them), or our orders count?
Assumption: the platform's result metric.
Answer: the platform result metric.

**Q2.5 — Multi-store**
Does Home show only the currently selected store, or can it show all stores combined?
Assumption: the current store only.
Answer: the current store only.
