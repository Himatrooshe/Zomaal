# Zomaal Shop & My Orders — QA handoff

## Current result

Production revision00066-bbg, application0e7d246;347 recorded observations,322 reviewed passes/25 failures across nine bug groups. Three raw harness expectations were corrected with review notes in JSON. Local Shop/admin unit tests:8 suites/97 passed. [Complete results and reproduction evidence](./live-server-test-results-2026-10-21.md).

No fixes deployed in this pass. Do not mark module complete.

## Reproduction / required regression cases

1. Deliver a full-price order2×12.50; then another2×12.50 with50% promo. Both COD delivered. Expected combined Purchases/Expenses37.50; observed50.00. Add multi-line discount rounding, zero-cost result and nonzero delivery allocations after agreeing accounting policy.
2. Deliver a MAD Shop order to an isolated BDT store. Verify FX conversion or explicit unconverted treatment; current code posts the same nominal number into base expenses.
3. Existing cart qty1: two parallel +1 requests; expect qty3. Four live rounds included qty2. Empty cart: two parallel first adds; expect one qty2 line; observed two qty1 lines. Add cart edit/clear vs checkout tests during fix.
4. Parallel checkouts from two stores for distinct variants of the same parent. Both success should leave parent=sum(variants); observed89 vs88. Also verify last-unit contention, cancellation vs purchase, no negative stock and lock ordering/deadlocks.
5. Empty address list: burst six creates with isDefault:false. Exactly one default required; observed three. Repeat concurrent default switches/deletes.
6. POST whitespace label/name/country/city/address must400; currently201/empty strings. PATCH null all required fields/default bool must400; six text fields500, bool200. Optional district clear remains separate policy.
7. Reject unsafe huge page/skip for merchant catalog/admin orders, and safely handle numeric order search outside Int bounds. Current requests yield500. Exponent/hex integer strings are currently accepted by Number coercion; choose strict digit policy only if intended.
8. Reject admin stock2147483648, price10^16 and computed order10^12×10000 before persistence. Preview must not advertise an unpersistable order as ready.10^12 unit price itself is valid Decimal(20,4), not an overflow.
9. tab=ALL plus status=CANCELLED must obey documented tab priority and include delivered orders.

## Working live regression baseline

Browse/favorites/variants, sequential address defaults, cart validation/repair/unavailable products, COD preview/order, double submit, simultaneous cancel/restock once, last-unit cross-store contention, admin lifecycle, terminal protections, delivered purchase idempotency, promo eligibility/caps/use restoration, COD3/90day restriction, anonymous/admin separation, viewer permission revocation and cross-store resource isolation passed. Consult recorded assertions for exact scope.

## Still needed

Real gateway choice/callbacks and refunds, real courier/COD collection, mobile screens and invoice/reorder/courier-name contract. Full Starter/Pro/expired/suspended acceptance was not covered. Packaging credit response was captured but detailed stock quantity/retry-failure recovery still needs dedicated assertions. Promo edits and cart edits during checkout need real PostgreSQL regression coverage. Do not infer exhaustive correctness from97 passing unit tests; live races escaped them.

## Fixture safety

Use disposable clearly labeled stores/catalog/products/addresses. Never place actual courier shipments or online charges merely to simulate delivery. Admin status updates here were synthetic accounting transitions. Preserve original oshi-ecom and its existing data. This audit removed its two test stores, four catalog products, eight promos and test order data; synthetic staff retains normal30-day deletion grace. Next unused synthetic staff phone after this audit is+12025550147. Original active store and seven before/after snapshots matched.
