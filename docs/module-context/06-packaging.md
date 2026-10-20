# 6. Packaging

## Screens
Packaging list · Add packaging item (photo, unit: pieces / rolls / meters / sheets, stock, minimum level,
"Auto Reorder Alert — WhatsApp alert when stock is low") · Details (stock, min level, used in products
"1 per order", stock history: used in order −1, restock +50) · Update stock.

## Data flow (as Figma shows it)
1. The merchant creates packaging materials with their stock.
2. On the product, the merchant picks which packaging is used (tab 5).
3. When an order is **delivered**, packaging stock goes down automatically.
4. When stock reaches the minimum, an alert is sent (WhatsApp).

## What's built

Packaging comes from two places (`source` on every response):
- **SHOP:** credited automatically when a Zomaal Shop order is delivered. Name, SKU and photo follow the
  shop catalog and can't be edited.
- **MANUAL:** added by the merchant ("Add packaging item"), for packaging bought anywhere else.

| Method | Path | Permission | What it does |
|---|---|---|---|
| GET | `/warehouse/packaging?search=&stockStatus=&source=` | `products.view` | List (also the Add Product selector). `stockStatus`: `IN_STOCK` / `LOW_STOCK` / `OUT_OF_STOCK` |
| POST | `/warehouse/packaging` | `products.add` | Add: name, sku, unit, openingStock, minimumLevel, lowStockAlert, imageUploadId |
| GET | `/warehouse/packaging/:id` | `products.view` | Details: stock, min level, products that use it |
| PATCH | `/warehouse/packaging/:id` | `products.edit` | Edit. unit / minimumLevel / lowStockAlert on any packaging; name / sku / photo on MANUAL only |
| DELETE | `/warehouse/packaging/:id` | `products.delete` | Archive. 409 while a product still uses it |
| PUT | `/warehouse/inventory/items/:inventoryItemId/stock` | `products.edit` | Update stock (existing endpoint) |
| GET | `/warehouse/inventory/items/:inventoryItemId/movements` | `products.view` | Stock history (existing endpoint) |

- **Photo:** `POST /warehouse/media` with `purpose=PACKAGING`, then pass the id as `imageUploadId`.
- **Units:** `PIECES`, `ROLLS`, `METERS`, `SHEETS`. Stock is whole numbers in that unit.
- **Stock status:** `OUT_OF_STOCK` when available ≤ 0, `LOW_STOCK` when available ≤ `minimumLevel`.
- **Used on delivery:** unchanged. Product packaging × units sold is deducted when the order is delivered
  (`PACKAGING_CONSUMED` in the history). The client Q6.1 answer confirms this per-unit rule.
- **Alert:** when `lowStockAlert` is on, the existing `LOW_STOCK` / `OUT_OF_STOCK` notifications cover
  packaging too (`entityType: PACKAGING_MATERIAL`, owner + staff with `products.view`). In-app and push
  only. The owner WhatsApp low-stock trigger is not yet wired (Q6.3). The 20 October live audit also found that the notification evaluator is disabled in production, so the implemented in-app alert logic is not currently being scheduled.
- **Cost:** the last price paid for that packaging in Purchases (tab 7). SHOP packaging with no purchase
  yet falls back to the Shop catalog price; MANUAL packaging never purchased counts as 0 (Q6.2).
- **Buying more:** record it in Purchases. With "Add to stock" on, the stock goes up there.

## Questions

**Q6.1 — Per order or per unit?**
If an order has 3 of the same product, deduct 1 box or 3?
Assumption: follow the quantity set on the product link. "1 per order" means 1 per order, regardless of quantity.
Answer: The client confirms: deduct 3 boxes for 3 product units. Consumption is per delivered unit.

**Q6.2 — Packaging cost**
Figma has no price field on packaging. Should packaging cost count in order profit?
Assumption: yes. The cost comes from Purchases (tab 7) as the average cost.
Answer: Yes, packaging cost must also be deducted. The answer does not explicitly settle average versus last paid cost.

**Q6.3 — Where does the low-stock WhatsApp alert go?**
To the owner's phone? Does it use the WhatsApp automation balance (tab 15)? Should it also show in Notifications (tab 16)?
Assumption: owner phone, not charged to the balance, and also shown in Notifications.
Answer: Owner phone and notification. An owner WhatsApp trigger is still missing; client/provider Meta prerequisites also remain relevant.

**Q6.4 — Restock from Zomaal Shop**
When the merchant buys boxes from Zomaal Shop, should packaging stock increase automatically on delivery?
Assumption: yes, if the shop item is linked to a packaging material.
Answer: Yes, delivered Shop purchases automatically increase packaging stock.

## Supplier names for Purchases

Packaging create/edit and read responses support `supplierNames`, matching warehouse products: at most 50 unique trimmed names, 1–120 characters each. Empty array clears the list; null is rejected. Purchase product-options returns the list and a recorded purchase retains its supplier/invoice snapshot independently of later catalog edits.

## Live audit — 20 October 2026

Client answers above were checked against the original Google Doc Q6.1–Q6.4. Five runtime/configuration/requirements findings remain open; see [Packaging live audit](../final-test/packaging/live-server-test-results-2026-10-20.md). Delivery, Shop replenishment and alert evaluator logic passed separate local PostgreSQL checks; they must not be described as live courier or message-delivery acceptance.
