# 5. Products, bundles, compare

## Screens
Products list (All / Active / Low stock / Out of stock, filter by category / stock / status) · Product
details (pricing summary, inventory, basic info) · Performance (7D / 30D / 90D / custom: delivery, cancel,
and return rates, revenue, cost, gross and net profit, ROI, top cities) · Update stock · Add / Edit product
(image, tracking code "Generate", status, pricing, purchase cost, inventory, variants, gift, packaging) ·
Bundle (select products, total auto-calculated) · Category create/select · Compare Products (A vs B).

## Data flow (as Figma shows it)
1. The merchant creates a product in Zomaal with price, purchase cost, stock, variants, and category.
2. Zomaal generates a **tracking code** (product code) used on labels and scans.
3. Orders reduce stock. Packaging linked to the product is deducted on delivery.
4. Performance and Compare read from orders, shipping statuses, and ad spend.

## Questions

**Q5.1 (blocker) — Where do products come from?**
Are they created only in Zomaal, imported from Shopify/YouCan, or both? If imported, how do we match a
platform product to a Zomaal product (by SKU)?
Assumption: they are created in Zomaal, and platform order lines are matched by SKU.
Answer: Both: created in Zomaal, and imported from the platforms. Platform order lines and imported products are matched to Zomaal products by SKU.

**Q5.2 (blocker) — When is stock deducted?**
Options: order placed, confirmed, shipped, or delivered. (Packaging says "on delivery".)
Assumption: stock is reserved at confirm or ship, and permanently deducted at delivery. It comes back if the order is cancelled or returned in Good condition.
Answer: Deducted at delivery. Implementation (Oct 2026): units are reserved at dispatch (not sellable, still on hand), permanently deducted at delivery, and released on cancel / return in Good condition. Damaged goes to the damaged bucket; Lost / Missing are written off.

How it is wired (`OrderStockService`, `EcommerceOrderLine.stockStatus`):
- Dispatch through a Zomaal courier → product + gift units reserved (bundles expand to components).
- Delivered (courier status, or platform timeline for orders shipped outside Zomaal) → reservation settled, product + gift + packaging deducted from on hand.
- Cancelled / refused / returned to seller → reservation released.
- Return scan: a delivered unit comes back (Good → on hand, Damaged → on hand + damaged); an undelivered unit only changes on Damaged (damaged bucket) or Lost / Missing (written off). Corrections undo the earlier condition first.
- Stock never blocks an order: if the merchant has fewer units than ordered, only what exists is moved and the movement reason says so.
- A platform-reported delivery that happened before Zomaal first synced the order line is not deducted (the merchant's stock count already excludes it).
- Order sync / Shopify webhooks now update order lines in place instead of deleting and recreating them, so line ids, return conditions, return-request links and stock status survive platform updates.

Order profit at delivery (`EcommerceOrderFinancialEvent.giftCost` / `packagingCost`):
- Net profit = collected − product cost − shipping − gift cost − packaging cost (− damage / loss events).
- Gift cost = gift's purchase cost × gift quantity × units sold.
- Packaging cost = quantity per unit × units × the unit price of the merchant's latest Zomaal Shop purchase of that material (shop catalog price if they never bought it); unknown → 0, never invented.
- If a delivered order is later cancelled / returned, revenue and product cost are reversed; shipping, gift and packaging cost stay (the courier was paid and gift / packaging were consumed).
- A parcel refused or returned before delivery books its shipping as a loss (`SHIPPING_LOSS`): the courier fee when the parcel went through a Zomaal courier, otherwise the shipping charged on the order. A plain cancellation (e.g. before pickup) books nothing. Separate courier return fees are not exposed by the courier data we store, so they are not added.
- Product Performance: net profit = gross profit − gift − packaging; ROI = net profit ÷ (product + gift + packaging cost). Compare Products uses the same costs. Shipping (order-level) and ad spend (Q5.5) are not allocated per product.

Edit product (`PATCH /warehouse/products/:id`, optimistic `version`):
- Details, prices, costs, low-stock thresholds, SKUs (empty string clears).
- Images: replace main image, add / remove gallery images (max 4), set a variant image. Upload first via media upload; replaced or removed files are deleted from storage after the edit commits. The main image can be replaced but not removed.
- Gift: set or replace; `null` removes it. Packaging list is replaced as a whole. Bundle components are replaced as a whole and the bundle cost is recalculated.
- Variants: add new combinations of the existing options (new option values are created; each gets a product code, barcode and opening stock). Remove only unused variants with no stock, no actual inventory movements, no purchases or order lines and no gift / bundle uses — otherwise archive the product. Only empty zero opening-balance initialization rows are discarded with an unused variant; actual stock history remains protected even after stock reaches zero.
- Orders already reserved keep working if a gift or bundle component changes: the old reserved items are released on cancel, or deducted on delivery (they physically shipped).

Import from platforms (`POST /warehouse/products/import`, up to 20 products per call):
- Pick products with `GET /warehouse/products/compare/products?platform=…`, then send their ids.
- Each variant keeps its platform SKU and price, and gets a Zomaal product code and barcode (a valid, unused platform barcode such as an EAN is kept).
- Cost: YouCan `cost_price` when present; Shopify and Lightfunnels do not expose cost to us, so it is 0 and the result says `costMissing: true` (edit it afterwards).
- Stock starts at 0 unless `importStock: true` (Shopify / YouCan quantity becomes the opening balance). After import, stock is managed only in Zomaal.
- Main image is copied from the Shopify / YouCan CDN when available; Lightfunnels gives no image URL.
- Lightfunnels has no option names: a multi-variant product gets one "Variant" option whose values are the variant titles.
- Skipped, not duplicated: products already imported (`ALREADY_IMPORTED`) or with any SKU already in Zomaal (`SKU_MATCHED`). Each product succeeds or fails on its own.
- Past order lines with matching SKUs are linked (same as creating a product). Lines of orders that were already delivered are marked delivered so they never deduct stock retroactively.

**Q5.3 — Stock sync back to the platform?**
Should Zomaal push stock levels to Shopify/YouCan?
Assumption: no, Zomaal is read-only toward platforms in v1.
Answer: No. Stock is managed only in Zomaal.

**Q5.4 — Purchase cost: fixed or from Purchases?**
Is cost typed once on the product, or updated from purchases (average cost)?
Assumption: typed on the product. A new purchase updates it to the weighted average.
Answer: Fixed: typed on the product.

**Q5.5 (blocker) — Ad spend per product (ROI, CPO, Net profit in Performance and Compare)**
Ads are per campaign, not per product. How do we link a campaign to a product?
Options: the merchant manually links campaigns to products, matching by campaign name, or no product-level ad cost.
Assumption: the merchant links campaigns to products manually.
Answer: Pending — will be answered later. Until then product ROI uses revenue − product cost only.

**Q5.6 — Bundle price and stock**
The total is "auto calculated" (sum of components). Can the merchant override it with a discount price? Bundle
stock = the smallest component stock?
Assumption: yes to both.
Answer: Yes to both: the merchant can set a discounted bundle price, and bundle stock = the smallest component stock.

**Q5.7 — Gift**
Is the gift product deducted from stock on each order, and is its cost counted in the order's profit?
Assumption: yes to both.
Answer: Yes to both: the gift is deducted from stock on each order and its cost is counted in the order's profit.

**Q5.8 — Tracking code format**
Is it random (e.g. 8 characters), or does the merchant type their own SKU? Do we need label printing (PDF / Bluetooth printer)?
Assumption: auto-generated with manual override, and no printing in v1.
Answer: Auto-generated.

## Client workflow: product code → order → tracking number

Every variant gets an auto-generated **Product Code** (e.g. `DH564BJ0`); a bundle's code is its **Pack Code** and
resolves to its components. Three identifiers are kept separate: Product Code (the product), Order ID (the customer
order) and Shipping Tracking Number (the shipment). The courier ticket carries the product code instead of the title.

Flow: product created → code generated → product added to an order (platform or manual) → order dispatched → courier
tracking number linked to the order → courier status updates → scan the courier barcode → order → product(s) → set
condition (Good / Damaged / Lost / Returned / Missing, optional damage cost) → stock, losses and profit update.

Status effects: Dispatched = reserve stock; Delivered = deduct stock, recognize revenue, product + shipping + packaging +
gift cost; Cancelled / Returned = release stock, reverse revenue; return condition decides restock vs. loss.

Products edit fixes (20 October 2026): blank normalized product names return 400; `description: null` clears the description. Image replacement/removal detaches assets as expired temporary uploads inside the product transaction, preserving the media attachment constraint and rollback behavior. Detached files are cleaned after commit; interrupted cleanup can be recovered by upload expiry cleanup. No schema migration is needed. PostgreSQL edit regression coverage runs in CI.


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
