# Final Test — QA and frontend handoff

Updated 22 October 2026. Start with [current status, completed fixes and open API gaps](./CURRENT-STATUS.md). The initial handoff reconciled recorded work; a subsequent backend correction passed full automated gates and 79/79 focused live observations. See the [completed backend work log](../backend-live-audit-fixes-2026-10-22.md).

- [Production OpenAPI snapshot](./openapi.production.json) — fetched from the live server on 22 October.
- [API inventory](./API-INVENTORY.md) — 331 published paths / 405 operations; publication is not live-test coverage.
- [Validation record](./HANDOFF-VALIDATION.md) — documentation and archive checks for this refresh.

## Module guides

| Module | Frontend | QA |
| --- | --- | --- |
| [Onboarding and auth](./onboarding/README.md) | [Guide](./onboarding/frontend-developer.md) | [Guide](./onboarding/qa-tester.md) |
| [Home dashboard](./home-dashboard/README.md) | [Guide](./home-dashboard/frontend-developer.md) | [Guide](./home-dashboard/qa-tester.md) |
| [Orders](./orders/README.md) | [Guide](./orders/frontend-developer.md) | [Guide](./orders/qa-tester.md) |
| [Returns](./returns/README.md) | [Guide](./returns/frontend-developer.md) | [Guide](./returns/qa-tester.md) |
| [Products, bundles and compare](./products/README.md) | [Guide](./products/frontend-developer.md) | [Guide](./products/qa-tester.md) |
| [Packaging](./packaging/README.md) | [Guide](./packaging/frontend-developer.md) | [Guide](./packaging/qa-tester.md) |
| [Purchases](./purchases/README.md) | [Guide](./purchases/frontend-developer.md) | [Guide](./purchases/qa-tester.md) |
| [Expenses](./expenses/README.md) | [Guide](./expenses/frontend-developer.md) | [Guide](./expenses/qa-tester.md) |
| [Staff and salary](./staff-salary/README.md) | [Guide](./staff-salary/frontend-developer.md) | [Guide](./staff-salary/qa-tester.md) |
| [Customers and risk](./customers-risk-center/README.md) | [Guide](./customers-risk-center/frontend-developer.md) | [Guide](./customers-risk-center/qa-tester.md) |
| [Customers and risk (alternate entry)](./customers-risk/README.md) | [Guide](./customers-risk/frontend-developer.md) | [Guide](./customers-risk/qa-tester.md) |
| [Zomaal Shop and My Orders](./zomaal-shop-my-orders/README.md) | [Guide](./zomaal-shop-my-orders/frontend-developer.md) | [Guide](./zomaal-shop-my-orders/qa-tester.md) |
| [Shop (alternate entry)](./shop/README.md) | [Guide](./shop/frontend-developer.md) | [Guide](./shop/qa-tester.md) |
| [eCommerce platforms](./ecommerce-platforms/README.md) | [Guide](./ecommerce-platforms/frontend-developer.md) | [Guide](./ecommerce-platforms/qa-tester.md) |
| [Shipping](./shipping/README.md) | [Guide](./shipping/frontend-developer.md) | [Guide](./shipping/qa-tester.md) |
| [Advertising](./advertising/README.md) | [Guide](./advertising/frontend-developer.md) | [Guide](./advertising/qa-tester.md) |
| [WhatsApp automation](./whatsapp/README.md) | [Guide](./whatsapp/frontend-developer.md) | [Guide](./whatsapp/qa-tester.md) |
| [Notifications](./notifications/README.md) | [Guide](./notifications/frontend-developer.md) | [Guide](./notifications/qa-tester.md) |
| [Settings and billing](./settings-billing/README.md) | [Guide](./settings-billing/frontend-developer.md) | [Guide](./settings-billing/qa-tester.md) |
| [Item Value](./item-value/README.md) | [Guide](./item-value/frontend-developer.md) | [Guide](./item-value/qa-tester.md) |
| [Tracking and pack returns](./tracking-workflow/README.md) | [Guide](./tracking-workflow/frontend-developer.md) | [Guide](./tracking-workflow/qa-tester.md) |

## Shared rules

Use actual API/provider data, exact enums and decimal precision. Never replace unknown FX/costs with zero or Figma samples with business data. Explicit synthetic preview modes must be labeled and excluded from production acceptance. Keep secrets and customer PII out of reports. Preserve the retained QA account; remove only clearly scoped disposable fixtures.

Read each module’s latest verification before historical audit reports. Unchecked checklists remain frontend/QA acceptance work. Reports, TikTok and Snapchat are outside this pass. Shop online payments and subscription checkout await the gateway decision. See CURRENT-STATUS for missing features and provider/configuration blockers.

## Shareable archive

`docs/final-test.zip` contains this folder plus referenced local documentation under a `docs/` root, including the live API snapshot. After extraction, open `docs/final-test/README.md`. Historical JSON evidence remains unchanged.
