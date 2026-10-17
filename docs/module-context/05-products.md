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
- If a delivered order is later cancelled / returned, revenue, product cost and shipping are reversed; gift and packaging cost stay (they were consumed and are not restocked).
- Product Performance: net profit = gross profit − gift − packaging; ROI = net profit ÷ (product + gift + packaging cost). Compare Products uses the same costs. Shipping (order-level) and ad spend (Q5.5) are not allocated per product.

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
