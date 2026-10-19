# 13. Shipping companies

## Screens
Shipping companies (tabs by country: Morocco / Algeria / Egypt / Tunisia, search) · Select country ("more
coming soon") · Courier API credentials · Courier details (connected since, sync status, Sync now,
performance trend: shipments / delivery / return, top delivery cities with rate) · Courier orders
(Pending / Confirm / Shipped / Delivered).

## Data flow (as Figma shows it)
1. The merchant connects their **own courier account** by entering API credentials.
2. Orders are sent to the courier and get tracking numbers.
3. Courier statuses sync back every 15 minutes (or by webhook). They drive order status, revenue, returns, and
   customer risk.

Built today: Sendit, QuickLivraison, ForceLog, OzoneExpress, Ameex (Morocco).

## Questions

**Q13.1 (blocker) — Where does the merchant click "ship this order"?**
Figma has no dispatch button on Order details. Should dispatch be one order at a time from details, bulk from the list, or
done in the courier's own dashboard (Zomaal only reads)?
Assumption: a single dispatch from Order details, plus bulk later.
Answer:

**Q13.2 — Couriers per country at launch**
Which couriers are required for Algeria, Egypt, and Tunisia, or are those tabs "coming soon"? The timeline
mentions "Onaqatii". Is that a courier we need?
Answer:

**Q13.3 — Shipping fee source**
Should we use the actual fee from the courier API, or a price list the merchant enters (per city)?
Assumption: the courier API when available, otherwise a merchant-entered default.
Answer:

**Q13.4 — Courier stats scope**
Do performance and top cities count only shipments made through Zomaal?
Assumption: yes.
Answer:

**Q13.5 — Return fees**
Do couriers charge a return fee? Should it be stored and counted as a loss?
Assumption: yes, when the courier reports it.
Answer:


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


## Live edge-case fixes — 20 October 2026

- Returns list enforces limit 1–100. Return costs must fit Decimal(20,4); oversized amounts and computed allocation totals return 400 before writes.
- Manual orders persist a SHA-256 fingerprint of the original retry request in a SYSTEM creation event. Exact retries remain valid after catalog price changes; changed payloads return 409. Older orders compare against persisted customer/shipping/line values.
- Financial reads and manual refreshes resolve the caller's active store or staff membership. Normal route permissions continue to apply.
- Explicit owner-authorized store deletion removes store-scoped inventory journals and dependent product/expense references transactionally. Normal inventory operations still retain immutable journals. Concurrent deletes recheck the last-store rule under the owner lock.
- A confirmed ForceLog parcel deletion cancels local shipment/dispatch state and releases reservations with financial synchronization in one transaction. A cancelled dispatch is terminal; use a replacement order for a new shipment. Provider errors cannot manufacture a successful cancellation.
- QuickLivraison callbacks verify the raw-body HMAC using the secret generated by the provider dashboard, held in Secret Manager. Signed events for untracked parcels are acknowledged without inventing local records. Invalid signatures still return 401.
