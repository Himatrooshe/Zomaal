# Item Value — frontend developer guide

## Handoff status — 22 October 2026

`7a1cb34` / revision `zomaal-backend-00072-kmd` passed 100/100 live observations. Store-scoped current physical stock valuation, whole-filter summaries, unknown costs/FX, permissions and isolation are deployed. No historical valuation or detailed Figma screen is provided; frontend/device and large-catalog acceptance remain separate. Reports are outside v1.

[Verification evidence](./live-server-test-results-2026-10-22.md) · [Cross-module status and API gaps](../CURRENT-STATUS.md) · [Production API contract](../openapi.production.json).

This refresh consolidates recorded work; it does not claim a new full regression run. Unchecked UI/QA checklists remain acceptance work. Revision names below identify the version tested at that time.

Updated 22 October 2026. No detailed Figma screen exists; the client confirmed current inventory valuation (`stock × cost`). Reports are excluded from v1. Deployed as `7a1cb34`, revision `zomaal-backend-00072-kmd`; 100/100 live observations passed.

## Request

`GET /warehouse/item-value?kind=PRODUCT_VARIANT&page=1&limit=20` with the merchant access token. Omit `kind` for both products and packaging; the other valid kind is `PACKAGING_MATERIAL`. Page is a positive safe integer, limit 1–100. Malformed, duplicated and unexpected query fields return 400.

Requires `products.view`. Owner reads follow the active store; staff follow their assigned store. Missing authentication returns 401, denied permission/deactivated staff 403, and no store 404. Never send a store ID to override scope. The response uses `Cache-Control: private, no-store`. Reload on store switch and drop stale in-flight responses.

## Display

The response has `items`, `total`, `page`, `limit`, and `summary`. `summary` covers all matching items, not just the visible page; apply `kind` to both rows and totals. Use stable `id` and `sourceId` identifiers. Product variants share a product name, so show `variantTitle`/`sku` when available.

- `summary.currency` is the store base currency. Amounts are decimal strings; preserve their precision. `unitCost` has four decimals; displayed valuation totals have two.
- `onHand = available + reserved + damaged`. Incoming stock is excluded. Archived/inactive physical inventory with stock is still included. Virtual bundles are excluded; their physical components are counted once.
- Product cost is the variant's warehouse `costPrice`. Packaging uses the latest purchase's actual paid total divided by quantity, including legacy Shop links and discounts. Current product costs are already in store currency; packaging foreign purchase cost uses a real FX quote.
- `unitCost: null` and null row values mean unknown. Legacy zero product costs are treated as unknown; a confirmed free packaging purchase is known zero (`0.0000` / `0.00`). Do not replace null with zero.
- When `summary.complete` is false, label `knownOnHandValue` as a known subtotal and show `unvaluedItemCount` / `unvaluedOnHandUnits`. It is not the complete business inventory value. Missing exchange quotes leave the affected stock unvalued.
- `knownAvailableValue`, `knownReservedValue` and `knownDamagedValue` distinguish sellable, allocated and damaged stock. Summary monetary fields sum displayed row values. No historical valuation is reconstructed; `asOf` identifies this snapshot.

Handle empty, loading, denied, incomplete valuation and retry states with real API responses. Do not invent inventory/costs or use Figma samples as business data.

[Requirements](../../module-context/18-reports.md) · [OpenAPI](../openapi.production.json).

[Deployment, live evidence and limits](./live-server-test-results-2026-10-22.md) · [Sanitized QA response examples](./live-server-results-2026-10-22.json).

Deployed Swagger: https://zomaal-backend-563898960389.us-central1.run.app/docs
