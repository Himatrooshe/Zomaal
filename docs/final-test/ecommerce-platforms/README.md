# eCommerce Platforms

## Handoff status — 22 October 2026

Shopify, YouCan and Lightfunnels OAuth, connection/data reads and synchronization are implemented. YouCan order-response parsing and timeline/fulfillment fixes are in the deployed history. First-sync history/provider retries need representative acceptance. Current Shopify storage exposes one connection per Zomaal store; two Shopify shops under one store are not a completed feature. No platform-request submission route is published in the deployed OpenAPI. Confirm that workflow before promising it.

[Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

- [Frontend developer guide](./frontend-developer.md)
- [QA tester guide](./qa-tester.md)
- Requirements and answered questions: [12-ecom-platforms.md](../../module-context/12-ecom-platforms.md)
- API schemas and routes: [OpenAPI](../openapi.production.json)
