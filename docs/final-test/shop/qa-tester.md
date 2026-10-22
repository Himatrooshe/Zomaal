# QA Tester Guide — Zomaal Shop and My Orders

## Handoff status — 22 October 2026

The detailed Shop & My Orders handoff records all nine bug groups fixed in `2b31110`, with 362/362 live observations passed. COD, cart, addresses, permissions and delivered acquisition-cost accounting have recorded coverage. Gateway checkout and the documented invoice/reorder/courier-name gaps remain open.

[Verification evidence](./../zomaal-shop-my-orders/fix-verification-2026-10-21.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [Shop (Figma section 1:10910), My Orders (1:11434)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/08-zomaal-shop.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Browse real catalog; product details/favorites/cart; address; COD or available checkout; My Orders.

## Test checklist

- [ ] Verify the success path against the matching Figma state using a connected test account.
- [ ] Check empty data, filters/pagination, nulls, invalid inputs, date and currency boundaries.
- [ ] Check authentication, role/plan permissions, store isolation, and disconnected-provider behavior.
- [ ] Check provider timeout/rate limits and retry/idempotency where applicable.
- [ ] Verify mutations through read APIs and check ledger/inventory effects where relevant.
- [ ] Mutate only an approved test account; clean up synthetic records unless asked to retain them.
- [ ] Report endpoint, environment, status, and masked test identifier only. Never include OTPs, passwords, tokens, API secrets, or customer PII.

## Module-specific checks

Use real catalog; test cart totals, product availability, COD restrictions, address validation, order lifecycle, and the unavailable online-payment state; never report an online payment as successful.

## Detailed current handoff

Use [zomaal-shop-my-orders](../zomaal-shop-my-orders/README.md), [frontend contract](../zomaal-shop-my-orders/frontend-developer.md), and [QA regressions](../zomaal-shop-my-orders/qa-tester.md). These describe the same module and supersede this entry's earlier generic checklist.
