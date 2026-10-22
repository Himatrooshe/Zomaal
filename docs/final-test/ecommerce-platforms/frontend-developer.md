# Frontend Developer Guide — eCommerce Platforms

## Handoff status — 22 October 2026

Shopify, YouCan and Lightfunnels OAuth, connection/data reads and synchronization are implemented. YouCan order-response parsing and timeline/fulfillment fixes are in the deployed history. First-sync history/provider retries need representative acceptance. Current Shopify storage exposes one connection per Zomaal store; two Shopify shops under one store are not a completed feature. No platform-request submission route is published in the deployed OpenAPI. Confirm that workflow before promising it.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026 (documentation reconciliation; original test dates are retained).

## References

- Figma: [eCom Platform (Figma section 1:5908)](https://www.figma.com/design/6g6gVrZZovSVOOfRB9vPGw/zomal-copy?node-id=0-1).
- [Module requirements](../../module-context/12-ecom-platforms.md).
- [OpenAPI contract](../openapi.production.json).

## Main flow

Connect platform; consent/callback; show connection; sync; inspect imported data; disconnect and retain history.

## Integration requirements

Use the routes and exact schemas in OpenAPI. Handle loading, empty, success, validation, permission, disconnected-provider, provider-error, and retry states. Preserve null/unconverted amounts as unknown; use store currency and API precision. Figma names, phone numbers, prices, and metrics are placeholders. Do not fabricate production-looking data. Where an approved client dependency is temporary static configuration, add an adjacent code comment identifying it as temporary and naming its source/assumption.

## Completion checklist

- [ ] In-scope Figma screens and states use API data.
- [ ] Request fields, enums, permissions, and store scoping match OpenAPI.
- [ ] Empty, loading, error, retry, access-denied, and disconnected states are covered.
- [ ] No real-looking catalog, metrics, or order data is hardcoded.
- [ ] Keep TikTok/Snapchat, Reports, and gateway-dependent checkout out of this pass.

## Current API integration notes

Use the provider OAuth/connection routes and `/ecommerce/connections`; sync and refresh via returned connection IDs. Preserve historical imports after disconnect and handle reconnect/provider errors. Do not promise multiple Shopify shops per Zomaal store or a “request platform” submission until those contracts exist. Treat 90-day initial history as an acceptance requirement/assumption to verify against each provider, not as a certified result. YouCan envelope parsing regression coverage exists; local eCommerce source still differs from the latest published release, so integrate against the production snapshot.
