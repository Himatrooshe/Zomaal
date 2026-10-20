# Zomaal Shop & My Orders — live audit, 21 October 2026

## Result

**Not ready for full sign-off. Nine confirmed backend bug groups were reproduced on production.** No application fixes or deployment were performed in this audit.

- API: `https://zomaal-backend-563898960389.us-central1.run.app`.
- Serving revision: `zomaal-backend-00066-bbg`, app `0e7d246b4aa5577738f824455c852fcdfb9fc48c`.
- 347 recorded observations: raw harness 319 passed / 28 failed expectations. Review corrected three invalid expectations: `10^12` fits Decimal(20,4), and exponent/hex page strings coerce to valid integers under the existing DTO contract. Reviewed result: **322 passed / 25 failed assertions**, grouped below. Those three corrections remain annotated in the JSON.
- Relevant local unit command: `npm test -- --runInBand --testPathPatterns='zomaal-shop|super-admin/shop'`: **8 suites / 97 tests passed**. Log: `/private/tmp/zomaal-shop-unit-audit.log`.
- This is an API/backend audit, not mobile UI or real fulfillment acceptance. No online charge or real courier shipment was made.

[Recorded responses and assertions](./live-server-results-2026-10-21.json)

## Confirmed findings

| ID | Priority | Finding and live evidence | Code paths |
| --- | --- | --- | --- |
| SHOP-01 | High | Discounted delivery overstates purchases/expenses. First delivery cost 25.00 MAD; second order subtotal 25.00, discount 12.50, paid total 12.50. Purchases/expenses became **50.00 instead of 37.50**. `recordPurchases` uses each undiscounted `lineTotal`, ignoring order discount and delivery allocation. Free-delivery case reproduced; nonzero fee allocation still needs policy and tests. | `shop-orders.service.ts` recordPurchases |
| SHOP-02 | High | Cross-currency delivery copies nominal amount into base-currency expenses. An isolated BDT store received a **30.00 MAD** Shop order; Purchases retained MAD, while Expenses added **30.00** directly to the BDT ledger without conversion or an unconverted bucket. Code passes item amount straight into Expense, which has no per-row currency. | `shop-orders.service.ts`, `purchase-expense.util.ts`, Expenses summary |
| SHOP-03 | High | Concurrent cart adds lose increments or duplicate a product line. One of four existing-line races returned two HTTP 201s but quantity **2 instead of 3**. Two first adds both returned 201 and produced **two separate quantity-1 lines**, not one quantity-2 line. | `cart.service.ts` addItem; cart uniqueness/locking |
| SHOP-04 | High | Concurrent checkouts for different variants leave parent stock stale. Both checkouts returned 201; parent stock **89**, actual variants sum **88**. Individual variant decrements remained valid. Aggregate/rewrite races across transactions. | `checkout.service.ts` reserveStock |
| SHOP-05 | Medium | Concurrent first-address creation can create multiple defaults. A six-request burst returned six 201s and **three default addresses**. A simpler pair and the first burst passed, so repeat under contention. | `address.service.ts` count/create/default transaction |
| SHOP-06 | Medium | Address validation accepts blanks and leaks 500s. Whitespace label/fullName/country/city/address accepted (201), then stored empty after trim. PATCH null label/fullName/phone/country/city/address each returned **500**; null isDefault was silently accepted (200). | Shop address DTO, PartialType, AddressService |
| SHOP-07 | Medium | Unbounded numeric queries produce 500s: merchant catalog huge page; admin orders huge page; admin numeric order search `999999999999999999999`. Validate safe page/skip and bound numeric search before Prisma. Exponent/hex acceptance alone is not classified as a bug. | catalog/admin query DTOs, StorefrontService, ShopOrdersAdminService |
| SHOP-08 | Medium | Persisted/computed numeric overflow returns 500. Admin stock `2147483648`; price `10000000000000000`; checkout at valid unit price `1000000000000` × qty `10000`. Preview misleadingly returned `canPlaceOrder:true` with total `10000000000000000.00`, then submit returned 500. Decimal(20,4) requires total <10^16. | admin catalog DTO/service, checkout computed money |
| SHOP-09 | Medium | `GET /shop/orders?tab=ALL&status=CANCELLED` still filters CANCELLED, hiding the delivered order. Swagger says status is ignored when tab is set. | `shop-orders.service.ts` resolveStatusFilter |

### Representative actual responses

```json
{"statusCode":500,"message":"Internal server error"}
```

Returned by null required address PATCH and numeric overflow probes above. The evidence JSON records paths and actual statuses.

```json
{"statuses":[201,201],"quantity":2}
{"statuses":[201,201],"lines":2,"quantities":[1,1]}
{"stock":89,"variantSum":88}
{"defaults":3,"statuses":[201,201,201,201,201,201]}
```

These are recorded observations from subsequent API reads, not mocked service outputs.

## Working flows verified live

- Home/categories/products/popular, variant details (sizes/colors/stock), favorites and idempotent repeated favorite addition.
- Normal cart merge, chosen variant prices, quantity limits including merged 10001 rejection, invalid cart bodies, insufficient-stock detection, quantity repair, draft/unavailable lines retained with blockers, hidden draft product detail/add.
- Sequential address creation, explicit default switch, default deletion/promoted replacement.
- Checkout preview, address snapshot, COD order, cart claim, exact item subtotal, unknown promo rejection, ONLINE unavailable (422).
- Double checkout: **201/400**, exactly one order. Concurrent merchant cancel: **200/409**, stock restored once.
- Different stores buying last unit: **201/409**, product stock zero, no oversell.
- Admin CONFIRMED → SHIPPED → DELIVERED; tracking number and merchant timeline; COD becomes PAID; delivered order cannot cancel; duplicate delivery returns409 and does not duplicate purchase rows.
- Delivered packaging credit endpoint response captured, and Purchases counts/quantities confirmed. Packaging stock count was not independently asserted in this audit.
- Percent/fixed discount, caps, minimum subtotal, future/expired/inactive promo rejection; case-insensitive code input; global/per-store one-use rejection; cancellation restores promo `usedCount` and permits reuse.
- Three merchant cancellations within the configured90-day window restrict COD: preview blocker + submit403; cart remains editable.
- My Orders All/Processing/Shipped/Delivered/Cancelled endpoint responses, search/filter DTO handling, malformed/unknown identifiers.
- Anonymous and merchant-to-admin token rejection; Shop viewer read access and purchase denial; old staff token loses access immediately after permission revocation.
- Cross-store order detail/cancel, address edit/delete, cart edit/delete, preview foreign address rejected404; cart data isolated.

## Figma comparison and remaining acceptance

Source: [Zomaal Figma](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy), page0:1 metadata inspected; screenshots inspected for product `1:11185`, checkout `1:11086`, and My Orders section `1:11434`.

- Core screen data exists for catalog, variants, cart, checkout, order lists and timeline.
- **View invoice** is visible in My Orders design. No Shop invoice/download API was found. Existing purchase invoiceNumber fields and billing invoices belong to other flows.
- **Reorder** is visible. No dedicated Shop reorder operation exists. Frontend can compose product lookup/cart additions, but atomic replay, unavailable variants and changed-price behavior need a defined contract.
- Timeline design displays **courier name**. Shop order contract/schema only carries trackingNumber; no courier-name field was found.
- SHIPPED currently represents the OUT_FOR_DELIVERY current step. No separate courier callback/status or out-for-delivery timestamp exists for Shop fulfillment. Actual carrier acceptance is pending.
- Product context mentions tier prices; current code supports base/variant price and compare-at price, not quantity tiers. Confirm intended quantity pricing before sign-off.
- Figma shows a cancel button on a progressed timeline, while merchant cancellation currently allows PENDING only. Confirm policy; this was not silently changed.
- Plan gate is declared for Shop/Pro. This audit used the existing owner entitlement and a staff viewer, not real Starter subscription transitions, expired trials, plan purchase or suspension acceptance.
- Online payment is deliberately unavailable: client must choose/configure Moroccan gateway. COD restriction defaults3/90 days, delivery fee0, admin-managed fulfillment are current assumptions, not final client policy.
- Real courier delivery, actual COD collection/refund, downloadable invoice, mobile screens and paid-gateway callbacks remain untested/unavailable as described.

## Cleanup and data preservation

Two temporary stores, four synthetic catalog products, eight temporary promo codes and all test store orders/cart/addresses/purchases/expenses/packaging were removed. Catalog deletion succeeded after order/store cleanup. No media was uploaded, no cloud objects were created. Synthetic staff was scheduled for normal 30-day account deletion and deactivated before its temporary membership/store were removed.

Original active store restored. Before/after responses matched for original Shop home, cart, addresses, favorites, My Orders, Purchases and Expenses summary. Existing account and business data preserved. Normal authentication/activity audit records remain; synthetic user record retains the normal deletion grace period.

## Suggested fix order

1. Discount/fee allocation and currency-safe expense posting; cover zero/fully discounted orders and unavailable FX explicitly.
2. Serialize cart mutation/checkout and variant stock updates; enforce default-address invariant.
3. DTO/domain bounds, blank/null validation and All-tab precedence.
4. Regression tests against PostgreSQL, scoped tests/build/schema checks, then established merge → CI/CD → actual live retest.
5. Agree invoice/reorder/courier/tier/cancellation contracts and complete client/provider/mobile acceptance.

No claim that every possible edge case was exhausted. Scheduler/retry recovery after a packaging-credit failure, promo edits during checkout, cart edits racing checkout, deleted variants and all subscription states need further focused coverage during fixes.
