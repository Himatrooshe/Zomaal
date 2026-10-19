# 7. Purchases

## Screens
Purchases list (All / Manual / From Shop) · Purchases details (history: date, quantity, unit price, total
cost) · Add purchase (select product, purchase info, date) · Select product · empty state.

## Data flow (as Figma shows it)
1. **Manual**: the merchant records buying stock from a supplier (product, quantity, price, date).
2. **From Shop**: created automatically when the merchant orders from Zomaal Shop (tab 8).
3. Purchases feed the "Purchase Costs" category in Expenses (tab 9).

## What's built

| Method | Path | Permission | What it does |
|---|---|---|---|
| GET | `/purchases?tab=&source=&search=` | `shop.view` | Summary + one row per item (All / Manual / From Shop) |
| GET | `/purchases/product-options?search=&type=` | `shop.purchase` + `products.view` | Select product: warehouse products (with variants) and packaging. `type`: `PRODUCT` / `PACKAGING` |
| GET | `/purchases/groups/:key` | `shop.view` | Details: purchase history for one item |
| POST | `/purchases` | `shop.purchase` | Add a manual purchase |
| PATCH | `/purchases/:id` | `shop.purchase` | Edit a manual purchase |
| DELETE | `/purchases/:id` | `shop.purchase` | Delete a manual purchase |

- **What:** a product (`warehouseProductId`, plus `warehouseVariantId` when it has more than one variant)
  or a packaging item (`packagingMaterialId`). Every row has `itemType`: `PRODUCT` / `PACKAGING`.
- **Stock:** `addToStock` (default `true`) adds the quantity to on-hand stock (`PURCHASE_RECEIVED` in
  the stock history). Editing the quantity moves stock by the difference; deleting takes it back out.
  If that stock is already reserved, sold or damaged, the edit/delete is refused with 409.
  `stockAdded` on the response says whether this purchase moved stock.
- **Expense:** every purchase (manual and From Shop) creates one "Purchase costs" expense for
  quantity × unit price, kept in sync on edit and removed on delete. `paymentMethod` (default `CASH`) and
  the receipt photo (`receiptAssetId` from `POST /expenses/receipts`) live on that expense. Shop orders
  use `BANK` for online payment and `CASH` for cash on delivery.
- **From Shop:** created when a Shop order is delivered; read-only here. Stock comes from the Shop
  delivery itself, so these rows have `stockAdded: false`.
- **Product cost price is not changed** by a purchase. Packaging cost (order profit) uses the last price
  paid in Purchases (see tab 6).
- **Existing data:** purchases recorded before this release got their "Purchase costs" expense on
  migration. Their stock was not changed.

## Questions

**Q7.1 (blocker) — What can be purchased?**
In "Select a Product", should the merchant see warehouse products, packaging materials, or both?
Assumption: both.
Answer: Both — warehouse products and packaging.

**Q7.2 — Does a purchase increase stock automatically?**
Assumption: yes, stock goes up when the purchase is saved (manual), or when the Shop order is delivered (From Shop).
Answer: Yes by default, with an "Add to stock" switch on manual purchases for stock that was already counted.

**Q7.3 — Expense recording**
Is every purchase automatically an expense under "Purchase Costs"?
Assumption: yes, and it cannot also be added manually in Expenses (to avoid double counting).
Answer: Yes. Manual expenses in "Purchase costs" are refused, and a purchase's expense can only be changed from Purchases.

**Q7.4 — Supplier info**
Do we need supplier name, invoice number, or a receipt photo on manual purchases?
Assumption: an optional note + receipt photo. No supplier list.
Answer (original client Google Doc Q7.4): From the product, select the supplier name; the invoice number will be recorded.

Implementation: products and packaging accept `supplierNames` (up to 50 unique trimmed names, 1–120 characters each). `GET /purchases/product-options` returns that list. Create/edit a manual purchase with optional `supplierName` from that item's list and `invoiceNumber` (1–100 characters). Historical snapshots remain unchanged when item suppliers are edited. Omit these fields on update to preserve them; null and blank values are rejected. Legacy and Shop-created rows keep null values. This corrects the former local answer that incorrectly said no supplier list was needed.

## Purchases audit fixes — 20 October 2026

- Edit/delete reads and quantity deltas run inside each serializable transaction attempt, including receipt lookups. PostgreSQL regressions force overlapping reads and verify stock/purchase/expense consistency.
- Validate unit price and computed total against Decimal(20,4) before writes. Non-clearable optional PATCH values reject null; only notes and receiptAssetId support null clearing.
- List groups include currency in their opaque key (`<legacy-key>~MAD`). Always pass the returned key to details; do not construct keys in the frontend. Legacy keys still work; mixed history has null totalCost/currency plus totalCostByCurrency.
- The forward media migration supports private receipt and packaging assets, retains one owner per asset, and permits temporary detachment during replacement or ON DELETE SET NULL cleanup.
- Supplier fields are optional for compatibility; no supplier/invoice data is fabricated or backfilled for old purchases. A selected supplier must be configured on that exact item.
- Rollout requires `20261020010000_purchases_audit_fields_and_media_constraints` before the new application version. Local verification is distinct from production signoff.
