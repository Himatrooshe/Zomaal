# 7. Purchases

## Screens
Purchases list (All / Manual / From Shop) · Purchases details (history: date, quantity, unit price, total
cost) · Add purchase (select product, purchase info, date) · Select product · empty state.

## Data flow (as Figma shows it)
1. **Manual**: the merchant records buying stock from a supplier (product, quantity, price, date).
2. **From Shop**: created automatically when the merchant orders from Zomaal Shop (tab 8).
3. Purchases feed the "Purchase Costs" category in Expenses (tab 9).

## Questions

**Q7.1 (blocker) — What can be purchased?**
In "Select a Product", should the merchant see warehouse products, packaging materials, or both?
Assumption: both.
Answer:

**Q7.2 — Does a purchase increase stock automatically?**
Assumption: yes, stock goes up when the purchase is saved (manual), or when the Shop order is delivered (From Shop).
Answer:

**Q7.3 — Expense recording**
Is every purchase automatically an expense under "Purchase Costs"?
Assumption: yes, and it cannot also be added manually in Expenses (to avoid double counting).
Answer:

**Q7.4 — Supplier info**
Do we need supplier name, invoice number, or a receipt photo on manual purchases?
Assumption: an optional note + receipt photo. No supplier list.
Answer:
