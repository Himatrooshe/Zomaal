# Frontend Developer Guide — Zomaal Shop and My Orders

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

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Detailed current handoff

Use [zomaal-shop-my-orders](../zomaal-shop-my-orders/README.md), [frontend contract](../zomaal-shop-my-orders/frontend-developer.md), and [QA regressions](../zomaal-shop-my-orders/qa-tester.md). These describe the same module and supersede this entry's earlier generic checklist.
