# Zomaal Shop & My Orders — frontend handoff

## Handoff status — 22 October 2026

All nine confirmed bug groups were fixed in `2263e76`/`2b31110` and passed 362/362 live observations. Cart/checkout concurrency, address defaults/validation, query/money bounds and delivered purchase/FX accounting are corrected. Online payments await the gateway; Shop invoice download, dedicated reorder and courier-name contracts remain gaps. Real COD collection, carrier/device and complete plan-state acceptance are not certified.

[Verification evidence](./fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

## Status

The nine 21 October 2026 findings are fixed and deployed: 362/362 live checks passed on app 2b31110/revision 00068-vbx. Details are tracked in [fix verification](./fix-verification-2026-10-21.md). The original audit is retained below for context. [Audit and actual responses](./live-server-test-results-2026-10-21.md). The nine fixes are accepted in the tested API scope; mobile, gateway and missing design-feature acceptance remain open.

## Screen/API map

| Screen/action | Merchant API |
| --- | --- |
| Explore Shop | GET /shop/home, /shop/categories, /shop/products/popular |
| Catalog/search | GET /shop/products?categoryId=UUID&search=text&sort=newest&page=1&pageSize=20; sort also price_asc/price_desc/name, pageSize max50 |
| Detail/options | GET /shop/products/:id — sizes, colors, variants, specifications, prices, stock |
| Favorites | GET /shop/favorites; POST or DELETE /shop/favorites/:productId |
| Cart | GET /shop/cart; POST /shop/cart/items {productId,variantId?,quantity}; PATCH /shop/cart/items/:id {quantity}; DELETE /shop/cart/items/:id or /shop/cart |
| Addresses | GET/POST /shop/addresses; PATCH/DELETE /shop/addresses/:id |
| Checkout | POST /shop/checkout/preview {addressId?,promoCode?} |
| Place COD | POST /shop/orders {addressId,paymentMethod:"COD",promoCode?,note?} |
| My Orders | GET /shop/orders?tab=ALL|PROCESSING|SHIPPED|DELIVERED|CANCELLED&search=text |
| Track | GET /shop/orders/:id — items, pricing, shippingAddress, paymentStatus, trackingNumber, statusSteps, timeline, canCancel |
| Cancel | POST /shop/orders/:id/cancel {reason?} — PENDING only |
| From Shop purchases | GET /purchases?tab=FROM_SHOP |

## Integration rules

- Use authenticated active-store context. Shop is plan-gated; separate403 PLAN_UPGRADE_REQUIRED from403 PERMISSION_DENIED. Expired subscription writes may return 402. Shop viewer has shop.view; cart/addresses/checkout/cancel require shop.purchase. Favorites use shop.view.
- Keep money as decimal strings; display API currency. Do not calculate totals with JavaScript binary floats or assume original store currency equals Shop currency.
- Re-preview after cart/address/promo edits; use blockers and line.problem, paymentMethods availability and codRestriction. ONLINE is unavailable, submit422; do not display a successful payment state.
- Both base/variant prices may have compareAtPrice; there is no quantity-tier contract today. Product variants must be selected when required.
- Placement returns 201; repeat taps currently produce one order and400/409, not an idempotent replay of its result. Reconcile GET cart/orders before retry after uncertain network outcomes.
- Cancel uses canCancel; stock/promo restores server-side. Three merchant COD cancellations in90days currently restrict new COD, while cart remains editable.
- PROCESSING combines PENDING+CONFIRMED. SHIPPED currently drives OUT_FOR_DELIVERY display. Use statusSteps rather than inventing extra courier events.

## Deployed corrected contract

- Cart mutations and checkout serialize per store. Historical duplicate lines merge on next add. Use returned line IDs after a merge.
- Addresses trim before validation. Blank required fields and null required PATCH fields/default bool return 400. Omit unchanged properties; district:null clears the optional district.
- Exactly one address remains default after a mutation, including concurrent creations/switches/deletions. isDefault:false still does not unset the only default.
- tab=ALL ignores the status parameter. PROCESSING covers PENDING+CONFIRMED.
- Pages are bounded 1–1,000,000; oversized numeric admin order searches safely return an unmatched result. Computed preview/checkout amounts beyond persistence range return 400. UI must handle preview validation errors as well as blockers.
- Delivered Purchases allocate actual paid acquisition cost including discount/delivery, in Shop currency. Purchase unitPrice is allocation/quantity rounded to four decimals; totalCost is authoritative. Quantity×displayed two-decimal unitPrice can differ by rounding cents.
- Expense amounts convert into store base currency at delivery; source cost, target amount and real FX rate are retained in expense notes. Missing FX returns 503 and leaves the order undelivered; retry when available. Never display a delivery success from a failed request.
- Parent stock/variant updates and cancellation use sorted parent-first locks across stores.
- No historical accounting backfill was performed. Existing earlier incorrect costs need reviewed reconciliation, if any.

## Figma/client dependencies

View invoice has no Shop download API. Reorder has no dedicated operation; do not promise atomic/order-price replay. Courier-name field is absent; no real Shop carrier callback test was done. Confirm tier pricing and whether post-confirmation cancellation is allowed. Moroccan gateway, delivery fee and cancellation policy remain client decisions. Separate actual COD cash collection from the admin-driven accounting PAID state.
