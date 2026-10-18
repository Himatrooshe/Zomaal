# Orders Excel export — QA guide

Released from `feature/orders-export` on `main` at commit `49a9517`. The production CI/CD run passed, including its deployed revision health check. Use a dedicated test store for authenticated production QA.

## Setup

Use a dedicated test store with orders from at least two platforms, including a manual order, a cancelled order, a refunded order, and a dispatched order. Obtain an owner token, staff token with `orders.export`, staff token without that permission, and a token for another store. Keep real tokens and customer data out of tickets.

`GET {{BASE_URL}}/ecommerce/orders/export` uses the same filters and defaults as `GET /ecommerce/orders`, except there is no `page` or `limit` parameter. Send `Authorization: Bearer {{TOKEN}}`. Successful responses have XLSX content type and an attachment filename `zomaal-orders-YYYY-MM-DD.xlsx`. The workbook has one sheet, `Orders`, and a header row even when there are no matches.

Example:

```bash
curl -sS -D headers.txt -H 'Authorization: Bearer {{TOKEN}}' \
  '{{BASE_URL}}/ecommerce/orders/export?platform=SHOPIFY&includeDispatched=true' \
  -o orders.xlsx
```

Open `orders.xlsx` in Excel or LibreOffice. It must open without a repair warning.

## Checks

| ID | Action | Expected |
|---|---|---|
| OE-01 | Export as owner | `200`, real XLSX workbook, 20 named columns, one `Orders` sheet. |
| OE-02 | Export as staff with only `orders.export` | `200` for their store. |
| OE-03 | Export without/with invalid token | `401` JSON error. |
| OE-04 | Export as staff without `orders.export` | `403` JSON `PERMISSION_DENIED` for the orders module. |
| OE-05 | Export with no active store | `404` JSON error. |
| OE-06 | Export with the default query | Matches the default Orders list filters: cancelled, refunded, and dispatched orders excluded. |
| OE-07 | Set `includeCancelled=true`, `includeRefunded=true`, `includeDispatched=true` | Those orders appear; every matching row exports, independent of the current Orders list page. |
| OE-08 | Apply `platform`, `search`, `financialStatus`, `fulfillmentStatus`, or `includeInRevenue` | Rows match the equivalent Orders list filter across all pages. |
| OE-09 | Export from two different store accounts | No order from the other store appears. |
| OE-10 | Export with no matching rows | `200`, workbook has headers only. |
| OE-11 | Export more than 10,000 matching orders | `413` JSON error asking to narrow filters; no partial workbook. |
| OE-12 | Pass invalid enum/filter values or unexpected `page`/`limit` | `400` JSON validation error. |
| OE-13 | Use an order reference beginning with `=` | Cell remains text, not an executable formula. |
| OE-14 | Inspect monetary and date columns | Amounts are numeric cells formatted to two decimals; currency is a separate column; dates are UTC ISO text. |

The export contains order reference and external ID, platform, order/payment/fulfillment statuses, currency, gross sales, discounts, shipping charged, refunds, net sales, total collected, COD amount/status, item count, processed/cancelled timestamps, courier, and tracking number. It deliberately excludes customer name, phone, and address.

Record environment, commit, request URL, sanitized file/headers, and comparison against `GET /ecommerce/orders`. The automated tests and build pass. A PostgreSQL integration smoke test passed against a disposable, migrated database and in CI. The deployed route is reachable and requires authentication; an authenticated production download with a test store remains for QA.
