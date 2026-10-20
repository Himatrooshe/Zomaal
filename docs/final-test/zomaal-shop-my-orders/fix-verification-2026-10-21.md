# Zomaal Shop & My Orders — fixes, 21 October 2026

## Status

All nine audited bug groups have implementation fixes and local regression coverage. Deployment and production retest are pending. This file will be updated with the exact deployed revision and live results.

## Changes

- SHOP-01: Delivered Purchase costs allocate the actual paid total, including discount and delivery, proportionally across item gross values. Largest-remainder cent allocation is deterministic and preserves the order total. Zero-priced items use physical quantity weights for delivery-only cost. Purchase unit price is the allocated acquisition cost / quantity rounded to four decimals; totalCost is authoritative.
- SHOP-02: Purchases retain order currency; Expenses store the converted cost in store base currency. Real FX is loaded before the transaction; missing FX returns503 and leaves fulfillment and accounting unchanged. Converted monetary overflow rolls back delivery. Store currency is locked/rechecked before posting. Expense notes retain source cost, converted amount, currencies and rate for audit.
- SHOP-03: Cart add/update/delete/clear and checkout share a per-store transaction lock. Duplicate historical cart lines merge on next add without losing their aggregate quantity. Checkout reads current rows/prices/quantities under locks, rather than deleting and pricing a stale preflight snapshot.
- SHOP-04: Checkout/cancel/status changes lock parent products in sorted order before touching variants. Admin scalar/variant stock edits use the same parent-first convention. Variant aggregate totals cannot race against another checkout. Combined variant stock is bounded to the database Int range.
- SHOP-05: Address creation/update/deletion share the store lock and enforce exactly one default whenever addresses exist. Legacy multiple defaults repair on next address mutation.
- SHOP-06: Required address strings trim before validation; blank strings and null required PATCH fields/default bool return400. Omitted fields remain unchanged; nullable district remains supported.
- SHOP-07: Merchant/admin pages are bounded1–1,000,000. Oversized numeric admin searches safely omit the impossible numeric-order match and continue text search, returning200 with an empty result rather than500.
- SHOP-08: Catalog/variant/promo/settings money and stock integer inputs are bounded; computed checkout totals/lines and delivery FX totals are checked against Decimal(20,4) before persistence. Oversized checkout preview and placement return400; valid unit price10^12 remains allowed. Existing exponent/hex integer query coercion is unchanged.
- SHOP-09: `tab=ALL` takes priority over exact status, matching the API contract.
- Promo claim now rechecks the locked current offer, dates, global/per-store use and changed discount terms. No silent old-price promo application during a concurrent admin edit.

## Local verification

- Full unit suite:136 suites /1188 tests passed.
- Full PostgreSQL regression gates:11 suites /296 tests passed, including40 new Shop regressions.
- Shop tests cover accounting allocation, full discount/zero cost, nonzero delivery rounding, cross-currency posting, FX failure/overflow/currency-change rollback, concurrent carts/default addresses/variants/checkout/cancel, last-stock contention, legacy duplicates, validation and filter precedence.
- Four additional allocator unit tests cover exact cents, deterministic tie-breaking, free-item delivery and near-boundary amounts.
- `npm run build`, `npx prisma validate`, dedicated local `prisma migrate status`, scoped implementation/new-test ESLint, generated OpenAPI and whitespace checks are required before commit; see completed results below when rollout is recorded.
- Repository-wide ESLint retains pre-existing failures:580 errors /135 warnings. The scoped Shop implementation/new tests pass; full lint is not claimed clean.
- CI adds a dedicated `SHOP_TEST_DATABASE_URL` PostgreSQL gate. Tests only accept an explicitly configured localhost test/CI database, never the application URL as fallback.

## Database, scope and rollback

No dependency, schema or migration change. No bulk historical customer/order/purchase/expense rewrite. New delivery accounting is corrected prospectively; already recorded historical Shop costs require a separately reviewed reconciliation if affected. Existing historical duplicate carts/default addresses repair on next relevant mutation. Reverting the application is schema-compatible; corrected posted accounting amounts remain as stored.

Invoice/reorder/courier-name APIs, quantity tiers, real payment gateway, actual courier/COD collection and mobile acceptance retain the documented scope/client limits. These are distinct from the nine reproduced backend fixes.
