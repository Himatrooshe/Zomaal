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
Answer: An unverified returned parcel becomes Delayed 1–2 days after it came back.

**Q4.2 — Stock effect per condition**
Assumption: Good goes back to sellable stock. Damaged, Lost, and Missing count as a loss at cost price. Is that correct?
Answer: Yes. Good goes back to sellable stock; Damaged, Lost and Missing count as a loss at cost price.
Implementation (`conditionLoss`, shared by the profit ledger and the Return Detected loss summary): Lost / Missing = purchase cost × quantity; Damaged = the entered damage cost, or purchase cost × quantity when none is entered; Good / Returned = 0. Lines not linked to a Zomaal product have no known cost, so only an entered damage cost counts. Correcting a condition books only the difference (e.g. Lost → Good removes the earlier loss) instead of adding a second loss.

**Q4.3 — Which barcode is on the returned parcel?**
Assumption: the courier's own label (tracking number). Do any couriers put their own internal code instead?
Answer: The courier's label (tracking number).

**Q4.4 — Returns for orders not shipped through Zomaal**
Can a merchant log a return for an order shipped by a Shopify plugin or manually (no tracking in Zomaal)?
Assumption: yes, by searching the order number manually.
Answer: Yes, by entering the order number manually.


## Tracking and partial returns — 2026-10-20

- A shipping barcode resolves the shipment tracking number to one store-scoped order, then its product codes and pack components. Ambiguous tracking or courier references return HTTP 409; never choose the first match.
- Scan responses include pack component variant IDs, product codes, ordered component quantities, allocation entries, `conditionComplete`, and `conditionRevision`. QR pack `items` are `{productCode, quantity}` objects. Existing QR scans still resolve through `trackingNumber`; fetch the API for current status.
- `POST /ecommerce/returns/:id/verify` accepts multiple allocation rows per order line. Use `componentVariantId` for individual pack contents; `quantity` counts physical component units. Whole-pack rows count packs. Do not mix component rows and whole-pack rows for one line.
- For mixed conditions, supply explicit quantities on every repeated line. Each request replaces the allocation snapshot of each included line, rather than incrementing it. Omitted lines keep their previous snapshot. Duplicate condition rows for the same component are rejected; combine their quantities.
- Partial totals stay `NEED_VERIFICATION`, with `condition: null`. Complete mixed totals expose `condition: "MIXED"` and process the return. Corrections can reopen a completed return; another open return blocks reopening with 409 before stock changes.
- Send `expectedRevision` from the last read to reject stale changes with 409. Exact repeated allocations are safe and do not duplicate stock movements or losses. Refresh after a conflict.
- `GET /ecommerce/returns/:id` reads an existing return without creating another request. Use this endpoint for the processed return details screen.
- Conditions, stock, loss ledger and saved return status commit together. Damaged defaults to purchase cost unless an explicit total allocation damage cost is supplied; Lost/Missing use purchase cost. Money uses order currency and a real conversion rate when warehouse currency differs; missing rates return 503 before writes.
- Returns tiles count physical component units. Received value prorates actual order-line sale value by component purchase cost (physical quantities when every component cost is zero); damaged/missing values use actual loss cost.
- Delivered → Returned → genuinely Delivered again restores revenue/product cost through an immutable reinstatement event. Shipping, gift and packaging charges already incurred are not charged twice.
- Courier refreshes reject older timestamps and terminal-to-progress regressions. Ameex shipments can link through an unambiguous owner-scoped order reference; prefer the internal order UUID. Ambiguous references are not automatically applied.

Verification: the PostgreSQL tracking suite runs in CI alongside existing Returns and Products suites. Real provider ticket printing and physical parcel scanning still require an actual test parcel.
