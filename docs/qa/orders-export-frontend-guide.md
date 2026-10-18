# Orders Excel export — frontend guide

Released from `feature/orders-export` on `main` at commit `49a9517`. The production CI/CD run passed its deployed revision health check. The frontend can integrate against the deployed API.

## API

`GET {{BASE_URL}}/ecommerce/orders/export` downloads a real `.xlsx` file. The active store is taken from the authenticated session. Send a Zomaal bearer token. Staff need `orders.export`; the existing `GET /access/me` response contains `effectivePermissions` for hiding or disabling the action. Still handle `403` on direct requests.

Pass the same filter values as the Orders list:

| Parameter | Values/default |
|---|---|
| `platform` | `SHOPIFY`, `YOUCAN`, `LIGHTFUNNELS`, or `MANUAL`; omitted = all |
| `search` | Order ID or name search |
| `financialStatus` | Existing Orders API enum |
| `fulfillmentStatus` | Status string |
| `includeCancelled` | Boolean; default false |
| `includeRefunded` | Boolean; default false |
| `includeDispatched` | Boolean; default false |
| `includeInRevenue` | Boolean; optional |

Do not send list `page` or `limit`. The endpoint exports **all matches**, up to 10,000 rows. To export all orders including cancelled, refunded, and dispatched, send all three include flags as `true`. Otherwise it follows the current Orders list defaults, which exclude those rows.

## Download handling

The `200` response content type is `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, with `Content-Disposition: attachment; filename="zomaal-orders-YYYY-MM-DD.xlsx"`. Read it as a Blob/ArrayBuffer, not JSON. Use the returned filename when available. Revoke any temporary browser object URL after triggering the download. An empty match still produces a header-only workbook.

Show export progress and prevent accidental duplicate clicks during download. The workbook contains order identifiers, statuses, monetary amounts with their own currency column, UTC timestamps, and dispatch details. It contains no customer contact data. Monetary cells are numeric and formatted to two decimals; each row retains its order currency, so do not sum different currencies as one amount.

## Errors

Errors are JSON: `400` invalid filters, `401` expired/missing authentication, `403` no `orders.export`, `404` no store, `413` more than 10,000 matching rows, and `5xx`/network errors. For `413`, tell the user to narrow the list filters and retry. Do not save the error body as an `.xlsx` file.

The client answered “Excel” but did not specify columns. The implemented columns are documented in `docs/module-context/03-orders.md`; the formal endpoint is in `docs/api/openapi.yaml`.
