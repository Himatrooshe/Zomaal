# 4. Returns

Most of this is already decided. See `docs/returns-module.md`. Only the remaining gaps are listed here.

## Screens
Returns list (All / Need verification / Delayed / Processed) · Scan · Manual verification (search) · Return
detected (order, customer, products, financial impact: original value, shipping cost, net loss) · empty.

## Data flow (as Figma shows it)
1. The courier marks the parcel as returned, and it comes back to the warehouse.
2. Staff **scan** the courier barcode, or search manually, which resolves the order and its products.
3. Staff set a condition per product (Good / Damaged / Lost / Returned / Missing).
4. Stock and the loss figure update automatically.

## Questions

**Q4.1 — "Delayed" threshold**
Assumption: a return still unverified after 2 days is Delayed. Should it be fixed or configurable per store?
Answer:

**Q4.2 — Stock effect per condition**
Assumption: Good goes back to sellable stock. Damaged, Lost, and Missing count as a loss at cost price. Is that correct?
Answer:

**Q4.3 — Which barcode is on the returned parcel?**
Assumption: the courier's own label (tracking number). Do any couriers put their own internal code instead?
Answer:

**Q4.4 — Returns for orders not shipped through Zomaal**
Can a merchant log a return for an order shipped by a Shopify plugin or manually (no tracking in Zomaal)?
Assumption: yes, by searching the order number manually.
Answer:
