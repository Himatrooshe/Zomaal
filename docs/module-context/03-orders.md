# 3. Orders (list, details, timeline)

## Screens
Orders list (tabs All / Confirm / Delivered, search) · Order details (Customer info, Order info with
Source + COD amount + COD status, items, totals, Shipping info with courier + tracking + est. delivery,
Financial impact: revenue / shipping cost / net profit) · Order Timeline · empty state.

## Data flow (as Figma shows it)
1. Orders arrive from Shopify / YouCan / Lightfunnels sync (tab 12), or are manual orders.
2. The order is shipped with a courier (tab 13) and gets a tracking number.
3. Courier status updates feed the **timeline**. The Figma timeline is courier-style: "Picked up",
   "Out of zone", "Postponed", "Unreachable", "Collection point", "Packaging fees", "Returned to seller".
4. The details screen calculates per-order revenue, shipping cost, and net profit.

## Questions

**Q3.1 (blocker) — Is there an order confirmation step inside Zomaal?**
Tabs say "Confirm", and Home has "Total confirm orders value". In Moroccan COD, a call center usually
calls the customer to confirm first. Does the merchant or staff mark orders **Confirmed** in Zomaal, or does
"confirmed" come from the platform?
Assumption: it comes from the platform or courier. Zomaal has no confirmation workflow.
Answer:

**Q3.2 (blocker) — Timeline source**
The architecture says the timeline comes from the platform (Shopify events). The Figma timeline shows
courier events. Should we merge both into one timeline when the order was shipped with one of our couriers?
Assumption: yes, merged and sorted by time, with a source label on each event.
Answer:

**Q3.3 — Full order status list for the tabs**
Figma has All / Confirm / Delivered, but details show "Shipped". What is the final tab list?
Assumption: All / Pending / Confirmed / Shipped / Delivered / Cancelled / Returned.
Answer:

**Q3.4 — COD status: who marks "Collected"?**
Options: the courier settlement API, manual marking by the merchant, or automatic when Delivered.
Assumption: automatic on Delivered, with manual override.
Answer:

**Q3.5 — Can the merchant create or edit orders in the app?**
Staff permissions list "Edit Orders, Cancel Orders, Export Orders", but Figma has no create/edit screen.
Should edits and cancels be pushed back to Shopify/YouCan?
Assumption: manual orders can be created (the backend supports them). Cancel is pushed back to the platform, and edit is not in v1.
Answer:

**Q3.6 — Per-order "Net profit"**
Should it subtract a share of ad spend (CPO), or only product cost + shipping?
Assumption: product cost + shipping + packaging only. Ad spend is not assigned per order.
Answer:

**Q3.7 — Export Orders format?**
CSV or Excel? Which columns?
Answer:
