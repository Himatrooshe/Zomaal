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
Answer:

**Q5.2 (blocker) — When is stock deducted?**
Options: order placed, confirmed, shipped, or delivered. (Packaging says "on delivery".)
Assumption: stock is reserved at confirm or ship, and permanently deducted at delivery. It comes back if the order is cancelled or returned in Good condition.
Answer:

**Q5.3 — Stock sync back to the platform?**
Should Zomaal push stock levels to Shopify/YouCan?
Assumption: no, Zomaal is read-only toward platforms in v1.
Answer:

**Q5.4 — Purchase cost: fixed or from Purchases?**
Is cost typed once on the product, or updated from purchases (average cost)?
Assumption: typed on the product. A new purchase updates it to the weighted average.
Answer:

**Q5.5 (blocker) — Ad spend per product (ROI, CPO, Net profit in Performance and Compare)**
Ads are per campaign, not per product. How do we link a campaign to a product?
Options: the merchant manually links campaigns to products, matching by campaign name, or no product-level ad cost.
Assumption: the merchant links campaigns to products manually.
Answer:

**Q5.6 — Bundle price and stock**
The total is "auto calculated" (sum of components). Can the merchant override it with a discount price? Bundle
stock = the smallest component stock?
Assumption: yes to both.
Answer:

**Q5.7 — Gift**
Is the gift product deducted from stock on each order, and is its cost counted in the order's profit?
Assumption: yes to both.
Answer:

**Q5.8 — Tracking code format**
Is it random (e.g. 8 characters), or does the merchant type their own SKU? Do we need label printing (PDF / Bluetooth printer)?
Assumption: auto-generated with manual override, and no printing in v1.
Answer:
