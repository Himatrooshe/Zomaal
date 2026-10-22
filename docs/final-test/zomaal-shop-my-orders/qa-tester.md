# Zomaal Shop & My Orders — QA handoff

## Handoff status — 22 October 2026

All nine confirmed bug groups were fixed in `2263e76`/`2b31110` and passed 362/362 live observations. Cart/checkout concurrency, address defaults/validation, query/money bounds and delivered purchase/FX accounting are corrected. Online payments await the gateway; Shop invoice download, dedicated reorder and courier-name contracts remain gaps. Real COD collection, carrier/device and complete plan-state acceptance are not certified.

[Verification evidence](./fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

## Latest deployed result

**362/362 live observations passed, zero failures**, on revision 00068-vbx/app 2b31110. Both CI/CD jobs succeeded. Local verification: 136 unit suites/ 1188 tests; 11 PostgreSQL suites/ 297 tests, including 41 new Shop regressions. [Final verification and actual responses](./fix-verification-2026-10-21.md).

All nine confirmed API bug groups are resolved. Real provider/mobile and missing design-feature acceptance remain scoped below. Earlier audit counts were 347 observations/25 reviewed failed assertions; historical responses are preserved in the original audit files.

## Current regression expectations

1. Deliver a full-price order 2×12.50 and another with 50% discount. Combined acquisition cost is 37.50. Also cover line rounding, full discounts, zero cost and delivery allocation.
2. Deliver a foreign-currency Shop order to a store with a different base currency. Purchases retain Shop currency; Expenses use real FX. Missing FX must return 503 without delivery/accounting mutation.
3. Race cart increments, first-adds and checkout. Totals must include all accepted changes, with no duplicate cart line or repeated order after uncertain submissions. See final verification for covered races.
4. Race variant checkouts/cancellation/admin stock edits. Parent stock must equal its variants; no negative stock or duplicate restoration.
5. Race address creation/default switches/deletion. Exactly one default must remain when addresses exist.
6. Blank required address strings and null required PATCH fields/default boolean return 400. Optional district null may clear it.
7. Unsafe pages and oversized numeric order searches must not reach database overflow. Valid pages remain bounded. Exponent/hex query coercion is unchanged in Shop; do not apply Item Value's stricter query contract to this module.
8. Oversized stock, price and computed checkout totals return 400 before writes; preview must reject unpersistable totals. A unit price of 10^12 alone remains within Decimal(20,4).
9. `tab=ALL` overrides an exact status filter and includes delivered orders.

The pre-fix outcomes are retained in the original audit. All nine bug groups passed the final API retest. Client/device/provider limits remain below.

## Working live regression baseline

Browse/favorites/variants, sequential address defaults, cart validation/repair/unavailable products, COD preview/order, double submit, simultaneous cancel/restock once, last-unit cross-store contention, admin lifecycle, terminal protections, delivered purchase idempotency, promo eligibility/caps/use restoration, COD3/90 day restriction, anonymous/admin separation, viewer permission revocation and cross-store resource isolation passed. Consult recorded assertions for exact scope.

## Still needed

Real gateway choice/callbacks and refunds, real courier/COD collection, mobile screens and invoice/reorder/courier-name contract. Full Starter/Pro/expired/suspended acceptance was not covered. Packaging credit response was captured but detailed stock quantity/retry-failure recovery still needs dedicated assertions. Promo revalidation under lock and serialized cart/checkout behavior have PostgreSQL coverage in the final report; detailed untested combinations remain acceptance work. The old unit-only baseline missed live races; use the final 1,188-unit/297-PostgreSQL-test evidence for that fix, without treating any count as exhaustive correctness.

## Fixture safety

Use disposable clearly labeled stores/catalog/products/addresses. Never place actual courier shipments or online charges merely to simulate delivery. Admin status updates here were synthetic accounting transitions. Preserve original oshi-ecom and its existing data. This audit removed its two test stores, four catalog products, nine promos and nine test orders; synthetic staff retains normal 30-day deletion grace. Choose fresh, clearly synthetic identities for a new run; do not assume a historical suggested phone is still unused. Original active store and seven before/after snapshots matched.
