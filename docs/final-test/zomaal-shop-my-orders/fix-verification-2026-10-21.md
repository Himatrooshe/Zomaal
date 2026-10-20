# Zomaal Shop & My Orders — fixes, 21 October 2026

## Status

**All nine reported backend bug groups are fixed, merged to main, deployed and passed the production API regression.**

- Main fix: `2263e76b986b4c4f1424b6efa09fdfb75f936ea7`.
- Final application: `2b31110ed4ad68a2624b13dd11e989bd658efc4d` (catalog transaction-connection follow-up).
- Ready revision: **`zomaal-backend-00068-vbx`**, 100% traffic. Service and ready-revision commit labels verified; `/health` returned `Hello Zomaal!`.
- [Final CI/CD run](https://github.com/Himatrooshe/Zomaal/actions/runs/39490420113): **Test and build — success; Deploy production — success**. Cloud Build `6e9c55c6-c0af-419c-b2ea-2f70d195f8f3` succeeded.
- **362/362 live observations passed, zero failures** on the final revision. Includes the original regression scenarios, additional full-discount/FX/catalog-contention checks and explicit preservation verification.
- [Actual live responses and assertions](./live-fix-retest-results-2026-10-21.json).

This verifies backend/API fixes. Client decisions, missing design features, real payment/courier and mobile acceptance remain below.

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

- Full unit suite:136 suites / 1188 tests passed.
- Full PostgreSQL regression gates:11 suites / 297 tests passed, including 41 new Shop regressions.
- Shop tests cover accounting allocation, full discount/zero cost, nonzero delivery rounding, cross-currency posting, FX failure/overflow/currency-change rollback, concurrent carts/default addresses/variants/checkout/cancel, last-stock contention, legacy duplicates, validation and filter precedence.
- Four additional allocator unit tests cover exact cents, deterministic tie-breaking, free-item delivery and near-boundary amounts.
- `npm run build`, `npx prisma validate`, dedicated local `prisma migrate status`, scoped implementation/new-test ESLint, Prettier checks, generated OpenAPI and `git diff --check` passed. The local database reported 67 migrations and up-to-date schema. OpenAPI generation used dummy local-only configuration, with no real provider calls.
- Repository-wide ESLint retains pre-existing failures:580 errors /135 warnings. The scoped Shop implementation/new tests pass; full lint is not claimed clean.
- CI adds a dedicated `SHOP_TEST_DATABASE_URL` PostgreSQL gate. Tests only accept an explicitly configured localhost test/CI database, never the application URL as fallback.

## Database, scope and rollback

No dependency, schema or migration change. No bulk historical customer/order/purchase/expense rewrite. New delivery accounting is corrected prospectively; already recorded historical Shop costs require a separately reviewed reconciliation if affected. Existing historical duplicate carts/default addresses repair on next relevant mutation. Reverting the application is schema-compatible; corrected posted accounting amounts remain as stored.

Invoice/reorder/courier-name APIs, quantity tiers, real payment gateway, actual courier/COD collection and mobile acceptance retain the documented scope/client limits. These are distinct from the nine reproduced backend fixes.

## Production retest evidence

| Scenario | Actual final-revision result |
| --- | --- |
| Full-price +50% discounted delivered purchases | Purchases and Expenses **37.50 MAD**, matching25.00 +12.50 actually paid; previously50.00 |
| Fully discounted COD delivery | Order total0.00; no inflated acquisition costs; Purchase/Expense totals stay37.50; physical packaging stock still credited |
| Cross-currency delivery | **30.00 MAD → 378.79 BDT** at recorded real rate **12.626235591302548804 BDT/MAD**; independent decimal multiplication of the saved quote matched the posted amount |
| Existing cart parallel +1/+1 | All four rounds returned201/201 and quantity3 |
| Empty cart parallel first adds | One merged line, quantity2; both201 |
| Variant checkout contention | Both orders succeeded; parent88 = variant sum88 |
| Last-unit contention across stores | One201 and one409; stock zero, never negative |
| Address bursts | Both six-request bursts returned201 and exactly one default |
| Parallel catalog rename | All 12 requests returned200 without connection starvation |
| Blank/null required addresses |400, including all six previously500 null text fields; null default bool400 |
| Numeric boundaries | Huge merchant/admin pages400; huge numeric admin search200 without invalid numeric match; stock/price/computed overflow400; valid10^12 unit price200 |
| My Orders ALL priority | Delivered order included even when status=CANCELLED was supplied |
| Promo/COD lifecycle | Cancellation restored promo uses; repeated delivery/cancellation did not duplicate costs/restock; configured3/90 day COD restriction produced preview blocker and submit403 |
| Permissions/isolation | Viewer purchase denial/revocation, merchant/admin token separation and foreign store resource access protections passed |

FX quote shown above is the runtime delivery quote, not a guaranteed future rate. No real online charge, courier label/dispatch or physical COD collection was made. Nonzero delivery-fee allocation, unavailable FX, FX overflow, store-currency mutation during FX lookup, legacy duplicate repair and exact near-boundary allocation were verified locally against PostgreSQL/unit tests; production did not fabricate these dependency failures or alter global delivery settings to simulate them.

## Production cleanup

Both disposable stores were deleted with their 9 synthetic orders and related cart/address/customer accounting data. All four temporary catalog products and nine promo codes were deleted. No media files were uploaded. Synthetic staff 147 was deactivated and scheduled for normal 30-day deletion before membership/store removal; the pending-deletion user and normal authentication/admin activity logs remain by design.

Original store set and active store were explicitly rechecked after cleanup. Seven original before/after snapshots matched: Shop home, cart, addresses, favorites, My Orders, Purchases and Expenses summary. Original account/business data preserved. Credentials/tokens/owner snapshots are excluded from published evidence.

## Remaining acceptance

- Choose/configure the Moroccan payment gateway and test real charge/callback/refund behavior.
- Agree invoice download, reorder, courier-name, quantity-tier and post-confirmation cancellation contracts; original Figma gaps remain documented in the audit.
- Test real Shop courier fulfillment/COD collection and mobile UI.
- Complete all Starter/Pro/expired/suspended states and packaging-credit failure recovery; those were not claimed exhaustive here.
- Review historical Shop costs if any were posted incorrectly before this fix; no bulk financial backfill was run.
