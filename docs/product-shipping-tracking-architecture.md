# Product · Order · Shipping tracking architecture

**Audience:** Product + engineering — shared spine across modules.  
**Returns-specific plan:** [`returns-module.md`](./returns-module.md)  
**Courier HTTP contract:** [`shipping-provider-contract.md`](./shipping-provider-contract.md)  
**Safety:** [`no-dummy-static-data.md`](./no-dummy-static-data.md)

This file stores the **client architecture brief** that is **not** owned solely by the Returns module. Implement and plan those pieces on their own feature branches.

Figma mock numbers/names are placeholders only — do not treat them as data contracts.

---

## Core model (three identifiers)

| ID | Example | Role |
|---|---|---|
| **Product code** | `DH564BJ0` | Identifies the warehouse SKU / variant (printed on tickets instead of long titles) |
| **Order ID** | `ORD-10482` / internal UUID + `orderName` | Identifies one customer order |
| **Shipping tracking number** | `SH92831` / `TRK984562` | Identifies one shipment with the courier |

**Relationship (source of truth for scan):**

```text
Shipping tracking number
        ↓
      Order
        ↓
  Product code(s) / pack
```

Same product code can appear on many orders. **Never** key inventory or return condition off product code alone without the order (and preferably the shipment).

---

## End-to-end workflow (client)

```text
Product created → generate unique Product Code
        ↓
Product added to Order → Order ID
        ↓
Ship via courier → Shipping Tracking linked to Order
        ↓
Ticket carries tracking (+ product/pack codes as needed)
        ↓
Scan shipping barcode → resolve Order → resolve Product(s)
        ↓
Outbound: courier status (Delivered / Cancelled / …) drives revenue & stock
Inbound: warehouse sets condition (Good / Damaged / Lost / Returned / Missing)
        ↓
Inventory, returns, losses, costs, profit impact update
```

Order sources can be WhatsApp / phone / Instagram / Facebook / **manual order** — an online store is optional. Minimum link:

**Customer order → Product code(s) → Shipping tracking → Shipping status**

---

## Pack / multi-item problem

Dedicated **pack code** (e.g. `PK82LQ7`) maps to components in the DB:

```text
PK82LQ7
 ├── T-Shirt Black
 ├── Black Shorts
 └── Cap
```

Scanning/resolving a pack code should expand to component product codes — more reliable than parsing titles on the courier ticket.

In Zomaal today: `WarehouseVariant.productCode` doubles as pack code for bundles; scan resolve emits `PRODUCT` vs `PACK` shapes.

---

## Module ownership map

| Concern | Module / area | Notes |
|---|---|---|
| Generate & store product / pack codes | **Warehouse / Products** | Unique per store |
| Bundle composition | **Warehouse / Bundles** | Pack → components |
| Manual / WhatsApp-style orders | **Ecommerce manual orders** | Stores customer PII at rest |
| Platform orders (Shopify / YouCan / LF) | **Ecommerce sync** | Often no customer PII at rest |
| Create shipment + store tracking ↔ order | **Shipping / Dispatch** | See shipping-provider-contract |
| Courier status webhooks / sync | **Shipping** | Delivered, Cancelled, Returned, etc. |
| Scan tracking → order → lines/pack | **Ecommerce scan** (`GET /ecommerce/scan`) | Shared |
| Inbound condition + return requests | **Returns** | See returns-module.md |
| Revenue / damage ledger / net profit | **Order financials** | Status + condition driven |
| Order event history UI | **Order timeline** | Platform/courier events |

---

## Status-driven business updates (not Returns-only)

When courier (or platform) status becomes **Delivered** / **Cancelled** / **Denied** / **Returned** / etc., the app should update (owned by financials + inventory + metrics, fed by shipping):

- Stock sold vs available
- Delivered vs cancelled revenue
- Shipping cost / losses
- Profit: revenue − product cost − shipping − other costs

Returns module focuses on **warehouse verification** of physical goods and condition-based loss; it consumes the same tracking → order → product chain.

---

## Industry rules (shared)

1. Real platform/DB data only — no Figma seed catalogs ([`no-dummy-static-data.md`](./no-dummy-static-data.md))
2. Money as Decimal → API `.toFixed(2)`; currency from store/order — never invent from mocks
3. Missing optional fields → `null`
4. Work on **feature branches**; merge intentionally (`.cursor/rules/work-on-feature-branches.mdc`)
5. **Before coding on a feature branch, always fetch and merge latest `main` into that branch** so fixes land on current code

---

## Follow-up work (other branches — not Returns)

Use separate tickets/branches, for example:

- [ ] Product-code generation / label print completeness
- [ ] Pack expand UX + ticket printing
- [ ] Manual order + dispatch “happy path” demo script
- [ ] Courier webhook → financial recognition reliability (Delivered / Cancelled)
- [ ] Persist courier webhook payloads (known Sendit/QL in-memory bug — see project notes)

When implementing Returns, link here; do not duplicate this spine inside `docs/returns-module.md` beyond what Returns consumes.


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
